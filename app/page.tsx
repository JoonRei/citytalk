"use client";
import dynamic from 'next/dynamic';
import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Send, X, Globe, Zap, Check,
  MapPin, Users, Lock,
  Minimize2, MessageCircle, MoreHorizontal,
  Trash2, Smile, Hash, Trophy, TrendingUp, ChevronRight,
  Clock, Bell, Navigation, LogOut, AlertTriangle
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getDetailedLocation } from '../lib/location';
import { RealtimeChannel } from '@supabase/supabase-js';

// --- DYNAMIC MAP IMPORT ---
const MapInterface = dynamic(() => import('../components/MapInterface'), { 
  ssr: false,
  loading: () => <div className="h-full w-full bg-zinc-900" />
});

// --- CONSTANTS ---
const POST_TTL = 24 * 60 * 60 * 1000; 
const SESSION_DURATION = 12 * 60 * 60 * 1000; 

// --- UTILS ---
const BANNED_WORDS = ['foul', 'badword', 'offensive', 'toxic', 'spam']; 
const scrubSignal = (text: string) => {
  let cleaned = text;
  BANNED_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '*'.repeat(word.length));
  });
  return cleaned;
};

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return Math.round(R * c);
}

const getRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
  return `${Math.floor(diffInSeconds / 86400)}d`;
};

const getPostLife = (dateString: string) => {
    const created = new Date(dateString).getTime();
    const now = Date.now();
    const elapsed = now - created;
    const remaining = POST_TTL - elapsed;

    if (remaining <= 0) return { percent: 0, color: 'text-zinc-800', status: 'Expired' };

    const percent = (remaining / POST_TTL) * 100;
    
    let color = 'text-emerald-500'; 
    if (percent < 50) color = 'text-yellow-500'; 
    if (percent < 20) color = 'text-red-500'; 

    return { percent, color, status: Math.floor(remaining / (1000 * 60 * 60)) + 'h left' };
};

export default function CityTalk() {
  const [deviceId, setDeviceId] = useState<string>("");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [agreements, setAgreements] = useState({ location: false, safety: false, data: false });
  const [activeInfo, setActiveInfo] = useState<string | null>(null);
  
  const [isInitializing, setIsInitializing] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  const [posts, setPosts] = useState<any[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [replyInput, setReplyInput] = useState("");
  
  const [userLocation, setUserLocation] = useState<any>(null);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(false);
  const [mapFocus, setMapFocus] = useState<[number, number] | null>(null);
  const [talkerName, setTalkerName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isNameLocked, setIsNameLocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  
  const [notification, setNotification] = useState<{author: string, msg: string} | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [tick, setTick] = useState(0); 

  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isReplyFocused, setIsReplyFocused] = useState(false); 

  const [isTyping, setIsTyping] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const typingTimeoutRef = useRef<any>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const postsRef = useRef(posts);
  const repliesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { postsRef.current = posts; }, [posts]);

  // --- HELPER FUNCTIONS ---
  const triggerVibration = () => {
    if (navigator.vibrate) navigator.vibrate(200);
  };

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const triggerNotification = (author: string, msg: string) => {
    setNotification({ author, msg });
    triggerVibration(); 
    setTimeout(() => setNotification(null), 6000);
  };

  const handleToggleLeaderboard = () => {
    const newState = !showLeaderboard;
    setShowLeaderboard(newState);
    if (newState) {
        setSelectedPost(null); 
    }
  };

  const handleSelectPost = (post: any) => {
    setSelectedPost(post);
    if (post) {
        setShowLeaderboard(false); 
        setIsSidebarMinimized(false);
    }
  };

  const activePosts = useMemo(() => {
    return posts.filter(p => {
        const created = new Date(p.created_at).getTime();
        return (Date.now() - created) < POST_TTL;
    });
  }, [posts, tick]);

  const trendingCities = useMemo(() => {
    const cityCounts: Record<string, { count: number, lat: number, lng: number }> = {};
    activePosts.forEach(post => {
        if (!cityCounts[post.city]) {
            cityCounts[post.city] = { count: 0, lat: post.lat, lng: post.lng };
        }
        cityCounts[post.city].count += 1;
    });
    return Object.entries(cityCounts)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 5) 
        .map(([city, data]) => ({ city, ...data }));
  }, [activePosts]);

  useEffect(() => {
    let storedId = localStorage.getItem('citytalk_device_token');
    let storedName = localStorage.getItem('citytalk_signal_id');
    let lastChange = localStorage.getItem('citytalk_name_date');
    let sessionExpiry = localStorage.getItem('citytalk_session_expiry');
    
    if (sessionExpiry && parseInt(sessionExpiry) > Date.now()) {
        setIsAuthorized(true);
        localStorage.setItem('citytalk_session_expiry', (Date.now() + SESSION_DURATION).toString());
    }

    if (!storedId) {
      storedId = `user_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('citytalk_device_token', storedId);
    }

    if (storedName) {
      setTalkerName(storedName);
      if (lastChange) {
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const hasPassed = Date.now() - parseInt(lastChange) > thirtyDays;
        setIsNameLocked(!hasPassed);
      } else {
        setIsNameLocked(true);
      }
    }
    setDeviceId(storedId);

    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const hasActivePost = useMemo(() => activePosts.some(p => p.device_id === deviceId), [activePosts, deviceId]);

  const loadingSequence = [
    { msg: "finding neighborhood...", icon: <MapPin size={32}/>, color: "bg-blue-500", shadow: "shadow-blue-500/50" },
    { msg: "looking for people...", icon: <Users size={32}/>, color: "bg-green-500", shadow: "shadow-green-500/50" },
    { msg: "checking safety...", icon: <Lock size={32}/>, color: "bg-purple-500", shadow: "shadow-purple-500/50" },
    { msg: "joining city...", icon: <Globe size={32}/>, color: "bg-indigo-500", shadow: "shadow-indigo-500/50" }
  ];

  useEffect(() => {
    if (!isAuthorized) return;
    const fetchPosts = async () => {
      const { data } = await supabase.from('posts').select(`*`).order('created_at', { ascending: false }).limit(200);
      if (data) setPosts(data);
    };
    fetchPosts();
    
    const channel = supabase.channel('city-signals-room')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
        setPosts(prev => prev.some(p => p.id === payload.new.id) ? prev : [payload.new, ...prev]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
        setPosts(prev => prev.filter(p => p.id !== payload.old.id));
        if (selectedPost?.id === payload.old.id) setSelectedPost(null);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'replies' }, (payload) => {
        if (selectedPost && payload.new.post_id === selectedPost.id) {
           setReplies(prev => [...prev, payload.new]);
           if (payload.new.device_id !== deviceId) {
                setRemoteTyping(false);
                triggerVibration();
           }
        }
        const newReply = payload.new;
        if (newReply.device_id !== deviceId) {
             const parentPost = postsRef.current.find(p => p.id === newReply.post_id);
             if (parentPost && parentPost.device_id === deviceId) {
                 const isViewingThisPost = selectedPost && selectedPost.id === newReply.post_id && !isSidebarMinimized;
                 if (!isViewingThisPost) {
                     triggerNotification(newReply.author_name, newReply.content);
                 }
             }
        }
      })
      .on('broadcast', { event: 'typing' }, (payload) => {
         if (selectedPost && payload.payload.post_id === selectedPost.id && payload.payload.device_id !== deviceId) {
             setRemoteTyping(true);
             if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
             typingTimeoutRef.current = setTimeout(() => setRemoteTyping(false), 3000);
         }
      })
      .subscribe();
      
    channelRef.current = channel; 
    return () => { supabase.removeChannel(channel); };
  }, [isAuthorized, selectedPost, deviceId, isSidebarMinimized]);

  useEffect(() => {
    if (selectedPost) {
      setIsSidebarMinimized(false);
      const fetchReplies = async () => {
        const { data } = await supabase.from('replies').select('*').eq('post_id', selectedPost.id).order('created_at', { ascending: true });
        if (data) setReplies(data);
      };
      fetchReplies();
    } else { 
      setReplies([]); 
      setIsSidebarMinimized(false);
    }
  }, [selectedPost]);

  useEffect(() => {
    if (repliesEndRef.current) {
        repliesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [replies, remoteTyping]);

  const handleTyping = (text: string) => {
    setReplyInput(text);
    if (!selectedPost) return;
    channelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { post_id: selectedPost.id, device_id: deviceId }
    });
  };

  const handleFindCity = async () => {
    const loc = await getDetailedLocation();
    if (loc && loc.lat && loc.lng) {
      setUserLocation(loc);
      setMapFocus([loc.lat, loc.lng]);
      triggerToast(`You are in ${loc.city}`);
    }
  };

  const handleJumpToCity = (lat: number, lng: number, city: string) => {
    setMapFocus([lat, lng]);
    setShowLeaderboard(false);
    triggerToast(`Flying to ${city}`);
  };

  const handlePost = async () => {
    if (!input.trim() || !userLocation || hasActivePost) return;
    const cleanContent = scrubSignal(input); 
    const cleanName = talkerName || `Guest-${Math.floor(100 + Math.random() * 899)}`;
    
    const { data, error } = await supabase.from('posts').insert([{
      content: cleanContent, city: userLocation.city, lat: userLocation.lat, lng: userLocation.lng, author_name: cleanName, device_id: deviceId,
    }]).select();

    if (!error && data) {
      setPosts(prev => [data[0], ...prev]);
      setInput("");
      setIsInputFocused(false); 
      setMapFocus([userLocation.lat, userLocation.lng]);
      triggerToast("Message posted!");
    }
  };

  const handleSaveName = () => {
    if (isNameLocked) return;
    const scrubbed = scrubSignal(talkerName.trim());
    if (scrubbed.length < 2) return;
    setTalkerName(scrubbed);
    localStorage.setItem('citytalk_signal_id', scrubbed);
    localStorage.setItem('citytalk_name_date', Date.now().toString());
    setIsNameLocked(true);
    setIsEditingName(false);
    triggerToast("Nickname saved");
  };

  const handleLogout = () => {
      localStorage.clear();
      window.location.reload();
  };

  const confirmDeletePost = async () => {
    if (!selectedPost) return;
    await supabase.from('posts').delete().eq('id', selectedPost.id).eq('device_id', deviceId);
    setSelectedPost(null);
    setShowDeleteConfirm(false);
    triggerToast("Post deleted");
  };

  const handleReply = async () => {
    if (!replyInput.trim() || !selectedPost) return;
    
    // UPDATED: Manually blur active element to force keyboard close
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    const cleanReply = scrubSignal(replyInput); 
    const cleanName = talkerName || `Guest-${Math.floor(100 + Math.random() * 899)}`;
    const { error } = await supabase.from('replies').insert([{
      post_id: selectedPost.id, 
      content: cleanReply, 
      author_name: cleanName, 
      device_id: deviceId
    }]);

    if (error) {
        triggerToast("Failed to reply.");
    } else {
      setReplyInput("");
      setRemoteTyping(false);
      setIsReplyFocused(false); // UPDATED: Force the UI to drop down
    }
  };

  const handleStartTalking = () => {
    setIsInitializing(true); 
    let step = 0; 
    const interval = setInterval(() => { 
        if (step < 3) { step++; setLoadingStep(step); } 
        else { 
            clearInterval(interval); 
            setIsInitializing(false); 
            setIsAuthorized(true); 
            localStorage.setItem('citytalk_session_expiry', (Date.now() + SESSION_DURATION).toString());
        } 
    }, 1400); 
  };

  if (isInitializing) {
    const currentStep = loadingSequence[loadingStep];
    return (
      <main className="fixed inset-0 bg-[#020202] flex flex-col items-center justify-center z-[200] overflow-hidden select-none">
        <div className={`absolute h-[600px] w-[600px] rounded-full ${currentStep.color} opacity-10 blur-[150px] transition-all duration-1000 ease-in-out`} />
        <div className="relative flex flex-col items-center">
            <div className="relative h-48 w-48 flex items-center justify-center mb-16">
                <div className="absolute inset-0 rounded-full border border-white/5 border-t-white/20 animate-[spin_8s_linear_infinite]" />
                <div className="absolute inset-4 rounded-full border border-white/5 border-b-white/30 animate-[spin_4s_linear_infinite_reverse]" />
                <div className={`absolute inset-0 rounded-full ${currentStep.color} opacity-20 blur-xl animate-pulse transition-colors duration-700`} />
                <div key={loadingStep} className="relative z-10 text-white animate-in zoom-in-50 fade-in duration-500">
                    <div className={`p-4 rounded-2xl bg-white/5 border border-white/10 ${currentStep.shadow} shadow-2xl backdrop-blur-md`}>
                        {currentStep.icon}
                    </div>
                </div>
            </div>
            <div className="w-64 space-y-6">
                <div key={loadingStep + "txt"} className="animate-in slide-in-from-bottom-2 fade-in duration-500">
                    <p className="text-center text-[11px] font-bold text-white/60 uppercase tracking-[0.2em] mb-2">System Check</p>
                    <p className="text-center text-lg font-medium text-white lowercase tracking-tight">{currentStep.msg}</p>
                </div>
                <div className="h-[2px] w-full bg-zinc-900 rounded-full overflow-hidden">
                    <div className={`h-full ${currentStep.color} shadow-[0_0_10px_currentColor] transition-all duration-1000 ease-out`} style={{ width: `${((loadingStep + 1) / 4) * 100}%` }} />
                </div>
            </div>
        </div>
      </main>
    );
  }

  if (!isAuthorized) {
    return (
      <main className="fixed inset-0 bg-[#050505] flex items-center justify-center p-6 z-[100] select-none">
        <div className="w-full max-w-[340px] flex flex-col">
          <div className="mb-10">
            <h1 className="text-3xl font-bold text-white tracking-tighter">citytalk</h1>
            <p className="text-zinc-500 text-sm mt-3 leading-relaxed lowercase">chat with people in your neighborhood.</p>
          </div>
          <div className="space-y-3 mb-10">
            {[
              { id: 'location', label: 'show location', info: 'this lets you see who is talking near you.' },
              { id: 'safety', label: 'be kind', info: 'no mean words or spam allowed here.' },
              { id: 'data', label: 'keep your name', info: 'your nickname will stay the same on this phone.' }
            ].map((item) => (
              <div key={item.id} className="group">
                <button 
                  onClick={() => { setAgreements(prev => ({ ...prev, [item.id]: !prev[item.id as keyof typeof agreements] })); setActiveInfo(activeInfo === item.id ? null : item.id); }}
                  className={`w-full flex items-center justify-between p-5 rounded-3xl transition-all border ${agreements[item.id as keyof typeof agreements] ? 'bg-zinc-900 border-zinc-700' : 'bg-transparent border-white/5 hover:border-white/10'}`}
                >
                  <span className={`text-[13px] font-bold lowercase ${agreements[item.id as keyof typeof agreements] ? 'text-white' : 'text-zinc-500'}`}>{item.label}</span>
                  <div className={`h-5 w-5 rounded-full border flex items-center justify-center transition-all ${agreements[item.id as keyof typeof agreements] ? 'bg-blue-600 border-blue-600' : 'border-zinc-800'}`}>
                    {agreements[item.id as keyof typeof agreements] && <Check size={12} strokeWidth={4} className="text-white" />}
                  </div>
                </button>
                {activeInfo === item.id && (
                  <div className="px-5 py-3 animate-in fade-in slide-in-from-top-1">
                    <p className="text-[12px] text-zinc-500 lowercase leading-snug">{item.info}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button 
            disabled={!agreements.location || !agreements.safety || !agreements.data} 
            onClick={handleStartTalking} 
            className="w-full bg-white text-black py-5 rounded-[2rem] font-black text-sm lowercase hover:bg-zinc-200 transition-all disabled:opacity-10"
          >
            start talking
          </button>
        </div>
      </main>
    );
  }

  // --- MAIN APPLICATION ---
  return (
    <main className="h-[100dvh] w-screen overflow-hidden bg-zinc-900 text-white relative flex flex-col font-sans selection:bg-blue-500/30 select-none">
      
      {/* 1. Map Layer */}
      <div className="absolute inset-0 z-0 opacity-100">
        <MapInterface 
          posts={activePosts} 
          mapFocus={mapFocus} 
          setSelectedPost={handleSelectPost} 
          userDeviceId={deviceId}
        />
      </div>

      {/* 2. Top HUD */}
      <div className="absolute top-0 left-0 right-0 z-30 p-4 md:p-6 pointer-events-none flex justify-between items-start">
        <div className="bg-zinc-900/90 backdrop-blur-md px-4 py-2 md:px-5 md:py-2.5 rounded-full pointer-events-auto border border-white/10 flex items-center gap-3 shadow-xl hover:bg-black transition-all">
           <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
           <span className="text-[11px] md:text-[13px] font-bold text-white">{activePosts.length} online</span>
        </div>
        
        <div className="pointer-events-auto relative flex items-center gap-2">
           <button 
             onClick={handleToggleLeaderboard}
             className={`h-10 md:h-11 px-4 md:px-5 rounded-full backdrop-blur-md border shadow-xl flex items-center gap-2 transition-all ${
               showLeaderboard 
               ? 'bg-blue-600 border-blue-500 text-white' 
               : 'bg-zinc-900/90 border-white/10 text-zinc-300 hover:text-white hover:bg-black'
             }`}
           >
              <Trophy size={14} className="md:w-4 md:h-4" />
              <span className="text-[11px] md:text-[13px] font-bold">Top Cities</span>
           </button>
           
           <button 
             onClick={handleLogout}
             className="h-10 w-10 md:h-11 md:w-11 rounded-full backdrop-blur-md border border-white/10 bg-zinc-900/90 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 shadow-xl flex items-center justify-center transition-all"
           >
              <LogOut size={16} />
           </button>

           {/* Leaderboard Popup */}
           {showLeaderboard && (
             <div className="absolute top-full right-0 mt-3 w-64 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-2 fade-in z-50">
                <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2 bg-white/5">
                   <TrendingUp size={16} className="text-blue-400" />
                   <span className="text-[12px] font-bold uppercase tracking-widest text-zinc-400">Trending</span>
                </div>
                <div className="py-2">
                   {trendingCities.length === 0 ? (
                     <div className="px-5 py-4 text-center">
                        <p className="text-[12px] text-zinc-500">No activity yet.</p>
                     </div>
                   ) : (
                     trendingCities.map((item, index) => (
                       <button 
                         key={item.city}
                         onClick={() => handleJumpToCity(item.lat, item.lng, item.city)}
                         className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/5 transition-colors group text-left"
                       >
                         <div className="flex items-center gap-3">
                           <span className={`text-[12px] font-black w-4 ${index === 0 ? 'text-yellow-400' : 'text-zinc-600'}`}>
                             {index + 1}
                           </span>
                           <span className="text-[13px] font-bold text-zinc-200 group-hover:text-white truncate max-w-[100px]">
                             {item.city}
                           </span>
                         </div>
                         <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-white/5 text-[10px] font-bold text-zinc-400">
                              {item.count}
                            </span>
                            <ChevronRight size={12} className="text-zinc-700 group-hover:text-white" />
                         </div>
                       </button>
                     ))
                   )}
                </div>
             </div>
           )}
        </div>
      </div>

      {/* 3. Toast Notifications (System) */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[150] animate-in fade-in slide-in-from-top-4 w-full px-4 flex justify-center">
          <div className="px-6 py-3 bg-zinc-800 border border-white/20 rounded-full shadow-2xl flex items-center gap-3">
            <Check size={16} className="text-green-400" />
            <span className="text-[13px] font-bold text-white">{toast}</span>
          </div>
        </div>
      )}

      {/* 4. NEW MESSAGE NOTIFICATION */}
      {notification && (
        <>
        <div className="fixed inset-0 z-[165] bg-black/30 backdrop-blur-md animate-in fade-in duration-500" />
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[170] animate-in fade-in zoom-in slide-in-from-top-4 w-full px-4 flex justify-center pointer-events-none">
            <button 
               onClick={() => { 
                   const targetPost = posts.find(p => p.author_name === notification.author || p.content === notification.msg);
                   if (targetPost) handleSelectPost(targetPost); 
                   setNotification(null); 
               }}
               className="pointer-events-auto flex items-center gap-4 bg-zinc-900/90 backdrop-blur-xl border border-blue-500/30 p-4 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] max-w-sm w-full hover:bg-zinc-800 transition-all group"
            >
                <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0">
                   <Bell size={20} className="animate-pulse" />
                </div>
                <div className="flex flex-col text-left overflow-hidden">
                    <span className="text-[12px] text-blue-400 font-bold uppercase tracking-wider">New Reply</span>
                    <span className="text-[14px] text-white font-bold truncate">{notification.author}</span>
                    <span className="text-[12px] text-zinc-400 truncate">{notification.msg}</span>
                </div>
            </button>
        </div>
        </>
      )}

      {/* 5. MAIN INPUT */}
      <div 
        className={`fixed left-0 right-0 p-4 sm:p-8 z-20 w-full flex justify-center pointer-events-none transition-all duration-300 ease-out 
        ${isInputFocused ? 'bottom-[45vh] md:bottom-0' : 'bottom-0'}`}
      >
        <div className="w-full max-w-2xl pointer-events-auto">
            <div className="relative bg-zinc-900/95 backdrop-blur-2xl rounded-[2rem] sm:rounded-[2.5rem] p-2 border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5)] ring-1 ring-white/5 focus-within:ring-white/20 transition-all mb-safe">
            <div className="relative flex flex-col">
                <textarea 
                    disabled={hasActivePost} 
                    className="w-full bg-transparent !border-none !ring-0 !outline-none px-4 sm:px-6 py-4 text-[15px] sm:text-[16px] resize-none text-white font-medium min-h-[60px] placeholder:text-zinc-500 disabled:opacity-50 select-text [&::-webkit-scrollbar]:hidden" 
                    placeholder={hasActivePost ? "Message active..." : "Say something..."} 
                    rows={1} 
                    maxLength={200}
                    value={input} 
                    onFocus={() => setIsInputFocused(true)} 
                    onBlur={() => setIsInputFocused(false)} 
                    onChange={(e) => setInput(e.target.value)} 
                />
                
                <div className="flex justify-between items-center px-2 sm:px-4 pb-2 pt-1">
                    <div className="flex items-center gap-2">
                    <button 
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleFindCity} 
                        className={`h-9 px-3 sm:px-4 rounded-full flex items-center gap-2 text-[12px] font-bold transition-all ${userLocation ? 'bg-blue-600/20 text-blue-400' : 'bg-white/5 text-zinc-300 hover:text-white hover:bg-white/10'}`}>
                        <MapPin size={14} />
                        <span className="truncate max-w-[100px] sm:max-w-[150px]">
                            {userLocation ? userLocation.city : "City"}
                        </span>
                    </button>

                    <button 
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => !isNameLocked && setIsEditingName(!isEditingName)} 
                        className={`h-9 px-3 sm:px-4 rounded-full flex items-center gap-2 text-[12px] font-bold transition-all ${isNameLocked ? 'text-zinc-400 cursor-default' : 'bg-white/5 text-zinc-300 hover:text-white hover:bg-white/10'}`}>
                        {isNameLocked ? <Lock size={14} /> : <Smile size={14} />}
                        <span className="hidden xs:inline">{talkerName || "Name"}</span>
                    </button>
                    </div>

                    <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handlePost} 
                    disabled={!userLocation || !input || hasActivePost} 
                    className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-500 hover:scale-105 active:scale-95 transition-all shadow-lg disabled:opacity-20 disabled:scale-100 disabled:cursor-not-allowed">
                    <Send size={18} strokeWidth={2.5} className="-ml-0.5" /> 
                    </button>
                </div>
            </div>
            
            {/* Edit Name Popup */}
            {isEditingName && !isNameLocked && (
                <div className="absolute bottom-full left-0 mb-4 ml-8 animate-in slide-in-from-bottom-2 fade-in z-50">
                <div className="bg-zinc-800 border border-white/20 rounded-xl p-2 shadow-2xl flex items-center gap-2">
                    <input 
                        autoFocus 
                        className="bg-transparent border-0 ring-0 focus:ring-0 text-sm font-bold text-white outline-none w-32 sm:w-36 px-3 placeholder:text-zinc-500 select-text" 
                        placeholder="Name..." 
                        value={talkerName} 
                        onChange={(e) => setTalkerName(e.target.value.substring(0, 15))} 
                    />
                    <button onClick={handleSaveName} className="bg-white text-black text-[11px] font-bold uppercase px-3 py-2 rounded-lg hover:bg-zinc-200">Save</button>
                </div>
                </div>
            )}
            </div>
        </div>
      </div>

      {/* 5. SIDEBAR WITH TYPING INDICATORS */}
      {selectedPost && (
        <>
        {isSidebarMinimized && (
            <button 
                onClick={() => handleSelectPost(selectedPost)}
                className="fixed bottom-32 right-4 sm:bottom-36 sm:right-6 z-[60] h-14 w-14 bg-zinc-900 shadow-[0_10px_30px_rgba(0,0,0,0.5)] border border-white/10 rounded-full flex items-center justify-center animate-in zoom-in hover:scale-110 transition-all group">
                <MessageCircle size={24} className="text-white" />
                {replies.length > 0 && (
                    <div className="absolute -top-1 -right-1 h-5 w-5 bg-blue-600 rounded-full flex items-center justify-center text-[11px] font-bold text-white border-2 border-zinc-900">
                        {replies.length}
                    </div>
                )}
            </button>
        )}

        <div className={`fixed inset-y-0 right-0 h-[100dvh] w-full sm:w-[440px] z-[60] bg-zinc-900/95 backdrop-blur-3xl border-l border-white/10 shadow-2xl flex flex-col transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) ${isSidebarMinimized ? 'translate-x-full' : 'translate-x-0'}`}>
          <div className="flex-none px-6 py-5 flex items-center justify-between border-b border-white/5 bg-zinc-900 mt-safe-top">
            <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400">
                    <Hash size={20} />
                </div>
                <div>
                    <h3 className="text-[15px] font-bold text-white">Conversation</h3>
                    <div className="flex items-center gap-2 text-[12px] text-zinc-400 font-medium">
                        <span>Near {selectedPost.city}</span>
                        {userLocation && (
                           <>
                           <span className="text-zinc-600">•</span>
                           <span className="text-emerald-400 flex items-center gap-1">
                               <Navigation size={10} className="inline" />
                               {getDistance(userLocation.lat, userLocation.lng, selectedPost.lat, selectedPost.lng).toLocaleString()} km away
                           </span>
                           </>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setIsSidebarMinimized(true)} className="h-9 w-9 rounded-full bg-transparent hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                    <Minimize2 size={18} />
                </button>
                <button onClick={() => setSelectedPost(null)} className="h-9 w-9 rounded-full bg-transparent hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                    <X size={20} />
                </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scroll px-6 pt-6 pb-6 bg-zinc-900">
            <div className="mb-8 p-1">
                {/* ... Post Content ... */}
                <div className="flex items-center gap-3 mb-3">
                   {(() => {
                       const { percent, color } = getPostLife(selectedPost.created_at);
                       const radius = 18;
                       const circumference = 2 * Math.PI * radius;
                       const strokeDashoffset = circumference - (percent / 100) * circumference;
                       
                       return (
                           <div className="relative h-12 w-12 flex items-center justify-center shrink-0">
                               <svg className="absolute inset-0 w-full h-full rotate-[-90deg]">
                                   <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-zinc-800" />
                                   <circle 
                                      cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="3" 
                                      strokeDasharray={circumference} 
                                      strokeDashoffset={strokeDashoffset} 
                                      strokeLinecap="round"
                                      className={`${color} transition-all duration-1000 ease-linear`}
                                   />
                               </svg>
                               <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-[12px] font-bold shadow-sm z-10">
                                  {selectedPost.author_name.charAt(0).toUpperCase()}
                               </div>
                           </div>
                       );
                   })()}
                   
                   <div className="flex flex-col">
                      <span className="text-[14px] font-bold text-white leading-none mb-1">{selectedPost.author_name}</span>
                      <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-zinc-400 font-medium">{getRelativeTime(selectedPost.created_at)} ago</span>
                          <span className="text-zinc-600 text-[8px]">•</span>
                          {(() => {
                              const life = getPostLife(selectedPost.created_at);
                              return (
                                <span className={`text-[11px] font-bold flex items-center gap-1 ${life.color}`}>
                                    <Clock size={10} />
                                    {life.status}
                                </span>
                              );
                          })()}
                      </div>
                   </div>
                </div>
                <div className="pl-1">
                    <p className="text-[18px] leading-relaxed text-zinc-100 font-medium select-text cursor-text">{selectedPost.content}</p>
                </div>
            </div>

            <div className="relative flex items-center py-4 mb-4">
                <div className="flex-grow border-t border-zinc-800"></div>
                <span className="flex-shrink-0 mx-4 text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Replies</span>
                <div className="flex-grow border-t border-zinc-800"></div>
            </div>

            <div className="space-y-6">
              {replies.length === 0 && !remoteTyping ? (
                <div className="flex flex-col items-center justify-center py-12 opacity-60">
                   <MoreHorizontal size={32} className="text-zinc-600 mb-3" />
                   <p className="text-[13px] text-zinc-500 font-medium">No replies yet. Be the first!</p>
                </div>
              ) : (
                <>
                {replies.map((reply) => {
                  const isMe = reply.device_id === deviceId;
                  return (
                    <div key={reply.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''} animate-in slide-in-from-bottom-2 duration-300`}>
                        {!isMe && (
                             <div className="h-8 w-8 rounded-full bg-zinc-800 border border-white/5 flex items-center justify-center text-[12px] font-bold text-zinc-400 mt-2 shrink-0">
                                {reply.author_name.charAt(0).toUpperCase()}
                             </div>
                        )}
                        <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%]`}>
                             <div className={`px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed font-medium shadow-md select-text cursor-text ${
                                 isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-zinc-800 text-zinc-200 rounded-tl-sm'
                             }`}>
                                {reply.content}
                             </div>
                             <span className="text-[11px] text-zinc-500 mt-1.5 px-1 font-medium">{getRelativeTime(reply.created_at)}</span>
                        </div>
                    </div>
                  );
                })}
                {/* --- NICE TYPING INDICATOR --- */}
                {remoteTyping && (
                   <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="h-8 w-8 rounded-full bg-zinc-800 border border-white/5 flex items-center justify-center shrink-0">
                             <MoreHorizontal size={14} className="text-zinc-400 animate-pulse" />
                        </div>
                        <div className="px-4 py-3 bg-zinc-800/50 border border-white/5 rounded-2xl rounded-tl-sm flex items-center gap-1.5 w-fit">
                            <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-[bounce_1s_infinite_-0.3s]" />
                            <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-[bounce_1s_infinite_-0.15s]" />
                            <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-[bounce_1s_infinite]" />
                        </div>
                   </div>
                )}
                </>
              )}
              <div ref={repliesEndRef} />
            </div>
          </div>

          {/* SIDEBAR FOOTER (INPUT) */}
          <div className={`flex-none p-4 sm:p-6 bg-zinc-900 border-t border-white/5 transition-all duration-300 ${isReplyFocused ? 'pb-[35vh] md:pb-6' : 'pb-safe'}`}>
            <div className="relative flex items-center gap-2 bg-zinc-800 rounded-[1.5rem] p-1.5 border border-white/5 focus-within:ring-2 focus-within:ring-blue-600/30 transition-all mb-4">
                <textarea 
                  className="flex-1 bg-transparent border-0 py-3 pl-4 text-[14px] font-medium text-white placeholder:text-zinc-500 outline-none resize-none max-h-32 custom-scroll select-text [&::-webkit-scrollbar]:hidden" 
                  placeholder="Type a reply..."
                  rows={1}
                  value={replyInput} 
                  onFocus={() => setIsReplyFocused(true)} 
                  onBlur={() => setIsReplyFocused(false)} 
                  onChange={(e) => handleTyping(e.target.value)} 
                  onKeyDown={(e) => {
                      if(e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleReply();
                      }
                  }}
                />
                {/* UPDATED: Removed onMouseDown preventDefault so click blurs input */}
                <button 
                    onClick={handleReply} 
                    disabled={!replyInput.trim()}
                    className="h-10 w-10 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center disabled:opacity-50 disabled:bg-zinc-700 disabled:text-zinc-500 transition-all mr-0.5">
                    <Send size={16} strokeWidth={3} className="-ml-0.5" />
                </button>
            </div>
            {selectedPost.device_id === deviceId && (
                <button 
                  onClick={() => setShowDeleteConfirm(true)} 
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all text-[13px] font-bold">
                    <Trash2 size={16} /> Delete Post
                </button>
            )}
          </div>
        </div>

        {/* DELETE CONFIRMATION POPUP */}
        {showDeleteConfirm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                <div className="bg-zinc-900 border border-white/10 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95">
                    <div className="flex flex-col items-center text-center">
                        <div className="h-16 w-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                            <AlertTriangle size={32} className="text-red-500" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">Delete Conversation?</h3>
                        <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
                            This will permanently remove this post and all replies for everyone. This action cannot be undone.
                        </p>
                        <div className="flex gap-3 w-full">
                            <button 
                                onClick={() => setShowDeleteConfirm(false)}
                                className="flex-1 py-3 rounded-xl bg-zinc-800 text-white font-bold text-sm hover:bg-zinc-700 transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmDeletePost}
                                className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-500 transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        </>
      )}
    </main>
  );
}