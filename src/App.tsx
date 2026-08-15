import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface User { id: string; name: string; color: string; }
interface ChatMessage { id: string; userName: string; text: string; timestamp: Date; }

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [joined, setJoined] = useState(false);
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [myId, setMyId] = useState('');
  const [myColor, setMyColor] = useState('#4ECDC4');
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeTab, setActiveTab] = useState<'editor' | 'chat' | 'terminal'>('editor');
  const [editorContent, setEditorContent] = useState('// Welcome to CodeFlow\n// Share room ID with collaborators to start editing together\n\nfunction hello() {\n  console.log("Hello, World!");\n}\n');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (joined) {
      const s = io(window.location.origin, { transports: ['websocket', 'polling'] });
      setSocket(s);
      s.on('user:self', ({ userId, color }: any) => { setMyId(userId); setMyColor(color); });
      s.on('user:join', ({ userId, userName, color }: any) => {
        setUsers(prev => [...prev.filter(u => u.id !== userId), { id: userId, name: userName, color }]);
      });
      s.on('user:leave', ({ userId }: any) => {
        setUsers(prev => prev.filter(u => u.id !== userId));
      });
      s.on('chat:message', (msg: ChatMessage) => {
        setMessages(prev => [...prev, msg]);
      });
      s.on('operation', ({ type, pos, text, length }: any) => {
        setEditorContent(prev => {
          if (type === 'insert') return prev.slice(0, pos) + text + prev.slice(pos);
          if (type === 'delete') return prev.slice(0, pos) + prev.slice(pos + length);
          return prev;
        });
      });
      return () => s.disconnect();
    }
  }, [joined]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function joinRoom() {
    if (!userName.trim() || !roomId.trim()) return;
    setJoined(true);
  }

  function sendMessage() {
    if (!chatInput.trim() || !socket) return;
    socket.emit('chat:message', { text: chatInput });
    setChatInput('');
  }

  function copyRoomLink() {
    navigator.clipboard.writeText(roomId);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#0d1117', color: '#e6edf3' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: '#161b22', borderBottom: '1px solid #30363d' }}>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#58a6ff' }}>⚡ CodeFlow</span>
        {joined && (
          <>
            <span style={{ color: '#8b949e', fontSize: 13 }}>Room: <strong style={{ color: '#e6edf3' }}>{roomId}</strong></span>
            <button onClick={copyRoomLink} style={{ background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Copy Link</button>
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              {users.map(u => (
                <div key={u.id} style={{ background: u.color, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#000', cursor: 'pointer' }} title={u.name}>{u.name[0]?.toUpperCase()}</div>
              ))}
            </div>
          </>
        )}
      </div>

      {!joined ? (
        /* Join screen */
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0, background: 'linear-gradient(135deg, #58a6ff, #a371f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>CodeFlow</h1>
          <p style={{ color: '#8b949e', margin: 0 }}>Real-time collaborative code editor</p>
          <input placeholder="Your name" value={userName} onChange={e => setUserName(e.target.value)} onKeyDown={e => e.key === 'Enter' && joinRoom()}
            style={{ background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', padding: '10px 16px', borderRadius: 8, width: 280, fontSize: 15 }} />
          <input placeholder="Room code (share with collaborators)" value={roomId} onChange={e => setRoomId(e.target.value)} onKeyDown={e => e.key === 'Enter' && joinRoom()}
            style={{ background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', padding: '10px 16px', borderRadius: 8, width: 280, fontSize: 15 }} />
          <button onClick={joinRoom} style={{ background: '#238636', border: 'none', color: '#fff', padding: '10px 32px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Join Room</button>
        </div>
      ) : (
        /* Main editor area */
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Editor */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 4, padding: '4px 8px', background: '#161b22', borderBottom: '1px solid #30363d' }}>
              {(['editor', 'chat', 'terminal'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: activeTab === tab ? '#21262d' : 'transparent', border: 'none', color: activeTab === tab ? '#e6edf3' : '#8b949e', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13, textTransform: 'capitalize' }}>{tab}</button>
              ))}
            </div>
            {activeTab === 'editor' && (
              <textarea
                value={editorContent}
                onChange={e => { setEditorContent(e.target.value); socket?.emit('operation', { type: 'insert', pos: 0, text: e.target.value }); }}
                style={{ flex: 1, background: '#0d1117', color: '#e6edf3', border: 'none', padding: 16, fontSize: 14, fontFamily: 'monospace', resize: 'none', outline: 'none', lineHeight: 1.6 }}
                spellCheck={false}
              />
            )}
            {activeTab === 'chat' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, overflow: 'hidden' }}>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {messages.map(m => (
                    <div key={m.id} style={{ padding: '6px 10px', background: '#161b22', borderRadius: 6, borderLeft: `3px solid ${myColor}` }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: myColor }}>{m.userName}:</span>
                      <span style={{ fontSize: 13, marginLeft: 8 }}>{m.text}</span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder="Type a message..." style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', padding: '8px 12px', borderRadius: 6, fontSize: 13 }} />
                  <button onClick={sendMessage} style={{ background: '#238636', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Send</button>
                </div>
              </div>
            )}
            {activeTab === 'terminal' && (
              <div style={{ flex: 1, background: '#0d1117', padding: 16, fontFamily: 'monospace', fontSize: 13, color: '#7ee787' }}>
                <div>$ Collaborative terminal — share room to co-edit terminal sessions</div>
                <div style={{ marginTop: 8, color: '#8b949e' }}>Connect via WebSocket at /terminal/{roomId}</div>
              </div>
            )}
          </div>
          {/* Users sidebar */}
          <div style={{ width: 160, background: '#161b22', borderLeft: '1px solid #30363d', padding: 12 }}>
            <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Online</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ background: myColor, width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#000' }}>{userName[0]?.toUpperCase()}</div>
              <span style={{ fontSize: 13 }}>{userName} (you)</span>
            </div>
            {users.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ background: u.color, width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#000' }}>{u.name[0]?.toUpperCase()}</div>
                <span style={{ fontSize: 13 }}>{u.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
