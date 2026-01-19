"use client";
import { useEffect, useState, useRef, useMemo } from 'react';
import Map, { Marker, useMap, ViewStateChangeEvent, MapRef, Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Layers, Radio, ChevronRight, Users, Navigation, X, ChevronDown, ChevronUp } from 'lucide-react';

// --- YOUR TOKEN ---
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// --- HELPER: CALCULATE DISTANCE (Haversine Formula) ---
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return Math.round(R * c);
}

// --- MAP CONTROLLER ---
const MapController = ({ focus }: { focus: [number, number] | null }) => {
  const { current: map } = useMap();

  useEffect(() => {
    if (focus && map) {
      map.flyTo({
        center: [focus[1], focus[0]],
        zoom: 14, 
        pitch: 50,
        speed: 1.8, 
        curve: 1.2,
        essential: true
      });
    }
  }, [focus, map]);

  return null;
};

interface MapInterfaceProps {
  posts: any[];
  mapFocus: [number, number] | null;
  setSelectedPost: (post: any) => void;
  userDeviceId: string;
}

export default function MapInterface({ posts, mapFocus, setSelectedPost, userDeviceId }: MapInterfaceProps) {
  const mapRef = useRef<MapRef>(null);
  const [visiblePosts, setVisiblePosts] = useState<any[]>([]);
  const [activeUser, setActiveUser] = useState<any>(null);
  
  // Responsive State for Radar List
  const [isRadarOpen, setIsRadarOpen] = useState(true);

  // Identify "Me" to draw the line from
  const myPost = posts.find(p => p.device_id === userDeviceId);

  const [viewState, setViewState] = useState({
    longitude: -100,
    latitude: 40,
    zoom: 2,
    pitch: 0,
    bearing: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  // Collapse radar automatically on very small screens initially
  useEffect(() => {
    if (window.innerWidth < 640) setIsRadarOpen(false);
  }, []);

  // --- GENERATE THE ARC LINE DATA ---
  const arcData = useMemo(() => {
    if (!myPost || !activeUser) return null;
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [myPost.lng, myPost.lat],     // Start: Me
          [activeUser.lng, activeUser.lat] // End: Them
        ]
      }
    };
  }, [myPost, activeUser]);

  // --- RADAR LOGIC ---
  const updateVisiblePosts = () => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const bounds = map.getBounds();
    if (!bounds) return;
    const visible = posts.filter(post => bounds.contains([post.lng, post.lat]));
    setVisiblePosts(visible);
  };

  useEffect(() => { updateVisiblePosts(); }, [posts]);

  // Handle clicking a user
  const handleSelectUser = (post: any) => {
    if (post.device_id === userDeviceId) {
        setActiveUser(null);
    } else {
        setActiveUser(post);
    }
    setSelectedPost(post);
    setViewState(prev => ({
      ...prev, 
      longitude: post.lng, 
      latitude: post.lat,
      zoom: 14,
      pitch: 60 
    }));
  };

  return (
    <div className="relative h-full w-full bg-black overflow-hidden font-sans">
      
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(evt: ViewStateChangeEvent) => {
          setViewState(evt.viewState);
          updateVisiblePosts();
        }}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        projection={{ name: 'globe' } as any}
        fog={{ "range": [0.8, 8], "color": "#18181b", "horizon-blend": 0.05, "high-color": "#000000", "space-color": "#000000", "star-intensity": 0.4 }}
        terrain={{ source: 'mapbox-dem', exaggeration: 1.5 }}
        maxZoom={18} 
        minZoom={1.5} 
        attributionControl={false} // Hides the "Mapbox" text/links
        logoPosition="bottom-right" // Moves the logo to a corner (we'll hide it with CSS below)
      >
        <MapController focus={mapFocus} />

        {/* --- THE CONNECTION ARC LAYER --- */}
        {arcData && (
          <Source id="arc-source" type="geojson" data={arcData}>
            <Layer
              id="arc-glow"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#22d3ee",
                "line-width": 6,
                "line-opacity": 0.3,
                "line-blur": 3
              }}
            />
            <Layer
              id="arc-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#ffffff",
                "line-width": 2,
                "line-dasharray": [2, 2],
                "line-opacity": 0.9
              }}
            />
          </Source>
        )}

        {/* MARKERS */}
        {posts.map((post) => {
          const isMe = post.device_id === userDeviceId;
          const colorClass = isMe ? 'bg-amber-500' : 'bg-blue-600';
          const shadowClass = isMe ? 'shadow-[0_0_20px_rgba(245,158,11,0.6)]' : 'shadow-[0_0_20px_rgba(37,99,235,0.6)]';

          return (
            <Marker
              key={post.id}
              longitude={post.lng}
              latitude={post.lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                handleSelectUser(post);
              }}
            >
              <div className="group relative flex flex-col items-center justify-center cursor-pointer hover:z-50">
                 {/* Popup Name Tag */}
                 <div className="absolute bottom-full mb-3 hidden group-hover:flex flex-col items-center whitespace-nowrap z-50 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2">
                    <div className="relative flex items-center gap-2 px-3 py-2 bg-zinc-900/80 backdrop-blur-xl border border-white/20 rounded-full shadow-2xl text-white">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-black ${isMe ? 'bg-amber-500' : 'bg-blue-500'}`}>
                            {post.author_name ? post.author_name.substring(0,2).toUpperCase() : '??'}
                        </div>
                        <span className="text-xs font-medium tracking-wide pr-1">
                            {post.author_name || 'Anonymous'}
                        </span>
                    </div>
                 </div>
                 {/* Glowing Dot */}
                 <div className="relative w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform duration-200">
                    <span className={`absolute inline-flex h-full w-full rounded-full ${colorClass} opacity-40 animate-ping`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${colorClass} ${shadowClass} border border-white/40 ring-2 ring-black/50 z-10`}></span>
                 </div>
              </div>
            </Marker>
          );
        })}
      </Map>

      {/* Hide the Mapbox Logo specifically using inline styles */}
      <style jsx global>{`
        .mapboxgl-ctrl-logo {
          display: none !important;
        }
      `}</style>

      {/* --- RADAR LIST (RESPONSIVE) --- */}
      <div className="absolute top-20 left-4 z-30 pointer-events-none">
        <div className="pointer-events-auto flex flex-col gap-2">
            
            {/* Toggle Button (Visible when closed) */}
            {!isRadarOpen && (
                 <button 
                 onClick={() => setIsRadarOpen(true)}
                 className="h-10 px-4 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl flex items-center gap-2 text-white hover:bg-zinc-800 transition-all animate-in fade-in zoom-in"
               >
                  <Radio size={16} className="text-emerald-500 animate-pulse" />
                  <span className="text-[12px] font-bold">Radar</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-black/50 border border-white/5 text-[10px] font-bold text-white">
                    {visiblePosts.length}
                  </span>
               </button>
            )}

            {/* Expanded List */}
            {isRadarOpen && (
                <div className="w-64 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl transition-all animate-in slide-in-from-left-2 fade-in">
                <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                    <div className="flex items-center gap-2">
                        <Radio size={16} className="text-emerald-500 animate-pulse" />
                        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-300">Live Radar</span>
                    </div>
                    <div className="flex items-center gap-2">
                         <span className="px-2 py-0.5 rounded-full bg-black/50 border border-white/5 text-[10px] font-bold text-white shadow-inner">
                            {visiblePosts.length}
                        </span>
                        <button 
                            onClick={() => setIsRadarOpen(false)}
                            className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-white/10 text-zinc-400"
                        >
                            <ChevronUp size={14} />
                        </button>
                    </div>
                </div>
                
                <div className="max-h-[300px] overflow-y-auto custom-scroll">
                    {visiblePosts.length === 0 ? (
                    <div className="px-5 py-8 text-center flex flex-col items-center">
                        <Users size={24} className="text-zinc-700 mb-2 opacity-50" />
                        <p className="text-[12px] text-zinc-500 font-medium">No signal.</p>
                    </div>
                    ) : (
                    <div className="py-2">
                        {visiblePosts.map((post) => (
                        <button 
                            key={post.id}
                            onClick={() => handleSelectUser(post)}
                            className={`w-full px-5 py-3 flex items-center justify-between hover:bg-white/5 transition-colors group text-left border-b border-white/5 last:border-0 ${activeUser?.id === post.id ? 'bg-white/10' : ''}`}
                        >
                            <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-lg shrink-0 ${post.device_id === userDeviceId ? 'bg-amber-600' : 'bg-zinc-700 border border-zinc-600'}`}>
                                {post.author_name ? post.author_name.substring(0,2).toUpperCase() : '??'}
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[13px] font-bold text-zinc-200 group-hover:text-white truncate w-24">{post.author_name || 'Anonymous'}</span>
                                <span className="text-[10px] text-zinc-500 truncate w-24">{post.city || 'Unknown Location'}</span>
                            </div>
                            </div>
                            <ChevronRight size={14} className="text-zinc-700 group-hover:text-white transition-colors" />
                        </button>
                        ))}
                    </div>
                    )}
                </div>
                </div>
            )}
        </div>
      </div>

      {/* --- DISTANCE BADGE --- */}
      {activeUser && myPost && (
         <div className="absolute top-20 right-4 z-40 animate-in fade-in slide-in-from-top-4">
             <div className="flex items-center gap-3 pr-2 pl-4 py-2 bg-zinc-900/90 backdrop-blur-md border border-cyan-500/30 rounded-full shadow-[0_0_30px_rgba(6,182,212,0.3)]">
                 <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-cyan-400 font-bold tracking-widest leading-none mb-0.5">Connected</span>
                    <div className="flex items-baseline gap-1 text-white leading-none">
                        <Navigation size={10} className="text-zinc-400" />
                        <span className="font-bold text-sm">
                            {getDistance(myPost.lat, myPost.lng, activeUser.lat, activeUser.lng).toLocaleString()} 
                            <span className="text-xs font-normal text-zinc-500 ml-1">km</span>
                        </span>
                    </div>
                 </div>
                 <button 
                    onClick={() => setActiveUser(null)}
                    className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                 >
                    <X size={14} />
                 </button>
             </div>
         </div>
      )}

      {/* NOTE: CONTROLS HAVE BEEN REMOVED HERE AS REQUESTED */}

      <div className="absolute top-6 left-6 z-[10] pointer-events-none opacity-30 mix-blend-overlay">
         <Layers size={24} className="text-white" />
      </div>
      
      {/* VIGNETTE */}
      <div className="absolute inset-0 pointer-events-none z-[5]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#000000_120%)] opacity-60" />
      </div>
      <div className="absolute inset-0 pointer-events-none z-[1] opacity-[0.03]" 
           style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '60px 60px' }} 
      />
    </div>
  );
}