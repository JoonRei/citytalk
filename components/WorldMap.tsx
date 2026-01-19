"use client";
import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// This sub-component handles the actual moving of the map
function MapController({ center }: { center: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      // flyTo creates that smooth "zooming in" cinematic effect
      map.flyTo(center, 13, {
        duration: 2.5, // seconds
        easeLinearity: 0.25
      });
    }
  }, [center, map]);

  return null;
}

export default function WorldMap({ posts, onMarkerClick, center }: any) {
  // Custom Glow Marker
  const customIcon = L.divIcon({
    className: 'custom-signal-marker',
    html: `<div class="radar-ping"></div>`,
    iconSize: [20, 20],
  });

  return (
    <div className="h-full w-full">
      <MapContainer 
        center={[20, 0]} 
        zoom={3} 
        style={{ height: '100%', width: '100%', background: '#020202' }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        
        {/* THE FIX: This controller moves the map when 'center' changes */}
        <MapController center={center} />

        {posts.map((post: any) => (
          <Marker 
            key={post.id} 
            position={[post.lat, post.lng]} 
            icon={customIcon}
            eventHandlers={{ click: () => onMarkerClick(post) }}
          />
        ))}
      </MapContainer>
    </div>
  );
}