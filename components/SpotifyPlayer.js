'use client';

import { useRef, useState, useEffect } from 'react';

const EMBED_URL =
  'https://open.spotify.com/embed/playlist/1bVBu4lbmkImztLOHH9eSv';

export default function SpotifyPlayer() {
  const embedRef = useRef(null);
  const controllerRef = useRef(null);
  const [iFrameAPI, setIFrameAPI] = useState(undefined);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (document.getElementById('spotify-iframe-api')) return;
    const script = document.createElement('script');
    script.id = 'spotify-iframe-api';
    script.src = 'https://open.spotify.com/embed/iframe-api/v1';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (iFrameAPI) return;
    window.onSpotifyIframeApiReady = (SpotifyIframeApi) => {
      setIFrameAPI(SpotifyIframeApi);
    };
  }, [iFrameAPI]);

  useEffect(() => {
    if (playerLoaded || iFrameAPI === undefined) return;
    if (!embedRef.current) return;

    const uri = 'spotify:playlist:' + EMBED_URL.split('/').pop();

    iFrameAPI.createController(
      embedRef.current,
      { width: '100%', height: '152', uri },
      (controller) => {
        controller.addListener('ready', () => setPlayerLoaded(true));
        controllerRef.current = controller;
      }
    );
  }, [playerLoaded, iFrameAPI]);

  const onPlay = () => controllerRef.current?.play();
  const onPause = () => controllerRef.current?.pause();

const btnStyle = {
    background: '#1c2130',
    color: '#c3c9d6',
    border: '1px solid #2a3040',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 11,
    cursor: 'pointer',
  };
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: 340,
        background: '#14171f',
        border: '1px solid #222734',
        borderRadius: 12,
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#0b0d12',
          borderBottom: '1px solid #222734',
          fontSize: 12,
          color: '#8b93a7',
        }}
      >
        <span style={{ fontWeight: 600, color: '#e6e9ef' }}>
          Now Playing
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onPlay} style={btnStyle}>
            ▶
          </button>
          <button onClick={onPause} style={btnStyle}>
            ⏸
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            style={btnStyle}
          >
            {collapsed ? '▴' : '▾'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding: 8 }}>
          <div ref={embedRef} />
          {!playerLoaded && (
            <div
              style={{
                fontSize: 11,
                color: '#8b93a7',
                padding: '4px 2px',
                textAlign: 'center',
              }}
            >
              Loading Spotify…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

