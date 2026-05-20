import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Peer from 'peerjs';
import {
  AlertCircle,
  Check,
  Clipboard,
  Copy,
  Download,
  FileUp,
  Link,
  Loader2,
  PlugZap,
  RefreshCw,
  Send,
  ShieldAlert,
  Smartphone,
  UploadCloud,
  Wifi,
  X,
} from 'lucide-react';
import './styles.css';

const ROOM_PREFIX = 'ld';
const CHUNK_SIZE = 64 * 1024;
const PEER_OPTIONS = {
  host: import.meta.env.VITE_PEER_HOST || '0.peerjs.com',
  port: Number(import.meta.env.VITE_PEER_PORT || 443),
  path: import.meta.env.VITE_PEER_PATH || '/',
  secure: (import.meta.env.VITE_PEER_SECURE || 'true') === 'true',
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
};
const CONNECTION_STATUSES = {
  idle: 'Not connected',
  creating: 'Creating room',
  waiting: 'Waiting for device',
  joining: 'Joining room',
  connected: 'Connected',
  sending: 'Sending',
  receiving: 'Receiving',
  complete: 'Transfer complete',
  disconnected: 'Disconnected',
  failed: 'Failed',
};

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(7)))
    .map((value) => alphabet[value % alphabet.length])
    .join('');
}

function normalizeRoomCode(value) {
  return value.trim().replace(/^linkdrop-/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 40);
}

function peerIdForRoom(roomCode) {
  return `${ROOM_PREFIX}${normalizeRoomCode(roomCode).toLowerCase()}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusTone(status) {
  if (status === 'connected' || status === 'complete') return 'good';
  if (status === 'failed' || status === 'disconnected') return 'bad';
  if (status === 'sending' || status === 'receiving' || status === 'joining' || status === 'creating') return 'busy';
  return 'neutral';
}

function App() {
  const initialRoom = useMemo(() => normalizeRoomCode(new URLSearchParams(window.location.search).get('room') || ''), []);
  const [mode, setMode] = useState(initialRoom ? 'join' : 'create');
  const [roomCode, setRoomCode] = useState(initialRoom);
  const [joinCode, setJoinCode] = useState(initialRoom);
  const [createCode, setCreateCode] = useState(randomRoomCode());
  const [creatorName, setCreatorName] = useState('');
  const [joinerName, setJoinerName] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [message, setMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [receivedTexts, setReceivedTexts] = useState([]);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [sendProgress, setSendProgress] = useState(null);
  const [receiveProgress, setReceiveProgress] = useState(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const receiveBuffersRef = useRef(new Map());
  const sendingRef = useRef(false);
  const receivedFilesRef = useRef([]);

  const connected = status === 'connected' || status === 'complete';
  const canSend = connected && !sendingRef.current && !sendProgress;
  const inviteLink = roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : '';
  const hasInviteCode = Boolean(initialRoom && mode === 'join');
  const localName = mode === 'create' ? normalizeName(creatorName) : normalizeName(joinerName);

  useEffect(() => {
    receivedFilesRef.current = receivedFiles;
  }, [receivedFiles]);

  useEffect(() => {
    return () => {
      cleanupConnection();
      receivedFilesRef.current.forEach((file) => URL.revokeObjectURL(file.url));
    };
  }, []);

  function setFailure(messageText) {
    setStatus('failed');
    setError(messageText);
  }

  function cleanupConnection({ keepMessages = true } = {}) {
    if (connRef.current) {
      connRef.current.close();
      connRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    receiveBuffersRef.current.clear();
    setRemoteName('');
    sendingRef.current = false;
    setSendProgress(null);
    setReceiveProgress(null);
    if (!keepMessages) {
      setReceivedTexts([]);
      receivedFilesRef.current.forEach((file) => URL.revokeObjectURL(file.url));
      setReceivedFiles([]);
    }
  }

  function attachConnection(conn) {
    connRef.current = conn;
    conn.on('open', () => {
      setStatus('connected');
      setError('');
      setInfo('Devices are connected. Transfers now move directly between browsers.');
      conn.send({
        type: 'hello',
        name: localName || 'Connected device',
        roomCode,
        timestamp: Date.now(),
      });
    });
    conn.on('data', handleIncomingData);
    conn.on('close', () => {
      connRef.current = null;
      setStatus((current) => (current === 'failed' ? current : 'disconnected'));
      setInfo('The other device disconnected. Reconnect or create a new room to continue.');
    });
    conn.on('error', (err) => setFailure(err?.message || 'The peer connection failed.'));
  }

  function createRoom() {
    const name = normalizeName(creatorName);
    const code = normalizeRoomCode(createCode);
    if (!name) {
      setError('Enter your name before creating a room.');
      return;
    }
    if (code.length < 6) {
      setError('Enter a room code with at least 6 letters or numbers.');
      return;
    }
    cleanupConnection();
    setRoomCode(code);
    setJoinCode(code);
    setCreateCode(code);
    setMode('create');
    setStatus('creating');
    setError('');
    setInfo('');
    window.history.replaceState(null, '', `?room=${code}`);

    const peer = new Peer(peerIdForRoom(code), PEER_OPTIONS);
    peerRef.current = peer;
    peer.on('open', () => setStatus('waiting'));
    peer.on('connection', (conn) => attachConnection(conn));
    peer.on('error', (err) => setFailure(err?.message || 'Could not create the room.'));
    peer.on('disconnected', () => setStatus('disconnected'));
  }

  function joinRoom() {
    const name = normalizeName(joinerName);
    const code = normalizeRoomCode(joinCode);
    if (!name) {
      setError('Enter your name before joining a room.');
      return;
    }
    if (!code) {
      setError('Enter a room code first.');
      return;
    }
    if (code.length < 6) {
      setError('Enter the full room code from the creator.');
      return;
    }
    cleanupConnection();
    setRoomCode(code);
    setJoinCode(code);
    setMode('join');
    setStatus('joining');
    setError('');
    setInfo('');
    window.history.replaceState(null, '', `?room=${code}`);

    const peer = new Peer(undefined, PEER_OPTIONS);
    peerRef.current = peer;
    peer.on('open', () => {
      const conn = peer.connect(peerIdForRoom(code), {
        reliable: true,
        serialization: 'binary',
      });
      attachConnection(conn);
    });
    peer.on('error', (err) => setFailure(err?.message || 'Could not join the room.'));
    peer.on('disconnected', () => setStatus('disconnected'));
  }

  function reconnect() {
    if (mode === 'create') createRoom();
    else joinRoom();
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1600);
  }

  async function copyText(content) {
    await navigator.clipboard.writeText(content);
  }

  function sendJson(payload) {
    if (!connRef.current?.open) {
      setError('Connect another device before sending.');
      return false;
    }
    connRef.current.send(payload);
    return true;
  }

  function sendText() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError('Type a message before sending.');
      return;
    }
    if (
      sendJson({
        type: 'text',
        content: trimmed,
        senderName: localName || 'Connected device',
        timestamp: Date.now(),
      })
    ) {
      setMessage('');
      setError('');
      setInfo('Text sent.');
    }
  }

  async function sendFile() {
    if (!selectedFile) {
      setError('Choose a file before sending.');
      return;
    }
    if (!connRef.current?.open) {
      setError('Connect another device before sending a file.');
      return;
    }
    if (sendingRef.current) {
      setError('Wait for the current file transfer to finish.');
      return;
    }

    const file = selectedFile;
    const fileId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    sendingRef.current = true;
    setStatus('sending');
    setError('');
    setSendProgress({ name: file.name, loaded: 0, total: file.size, percent: 0 });

    try {
      connRef.current.send({
        type: 'file-meta',
        fileId,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        totalChunks,
        senderName: localName || 'Connected device',
        timestamp: Date.now(),
      });

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * CHUNK_SIZE;
        const chunk = await file.slice(start, start + CHUNK_SIZE).arrayBuffer();
        connRef.current.send({
          type: 'file-chunk',
          fileId,
          chunkIndex,
          totalChunks,
          data: chunk,
        });
        const loaded = Math.min(file.size, start + chunk.byteLength);
        setSendProgress({
          name: file.name,
          loaded,
          total: file.size,
          percent: Math.round((loaded / file.size) * 100),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      connRef.current.send({ type: 'file-complete', fileId });
      setStatus('complete');
      setInfo(`${file.name} sent successfully.`);
      setSelectedFile(null);
    } catch (err) {
      setFailure(err?.message || 'File transfer failed.');
    } finally {
      sendingRef.current = false;
      setTimeout(() => {
        setSendProgress(null);
        setStatus((current) => (current === 'complete' ? 'connected' : current));
      }, 1200);
    }
  }

  function handleIncomingData(data) {
    if (!data?.type) return;
    if (data.type === 'hello') {
      setRemoteName(normalizeName(data.name) || 'Connected device');
      setInfo(`${normalizeName(data.name) || 'A device'} joined this room.`);
      return;
    }

    if (data.type === 'text') {
      setReceivedTexts((items) => [
        {
          id: crypto.randomUUID(),
          content: data.content,
          senderName: data.senderName || remoteName || 'Connected device',
          timestamp: data.timestamp || Date.now(),
        },
        ...items,
      ]);
      setInfo('Text received.');
      return;
    }

    if (data.type === 'file-meta') {
      receiveBuffersRef.current.set(data.fileId, {
        meta: data,
        chunks: new Array(data.totalChunks),
        receivedChunks: 0,
        loaded: 0,
      });
      setStatus('receiving');
      setReceiveProgress({ name: data.name, loaded: 0, total: data.size, percent: 0 });
      return;
    }

    if (data.type === 'file-chunk') {
      const transfer = receiveBuffersRef.current.get(data.fileId);
      if (!transfer || transfer.chunks[data.chunkIndex]) return;
      const buffer = data.data instanceof ArrayBuffer ? data.data : data.data?.buffer;
      if (!buffer) return;
      transfer.chunks[data.chunkIndex] = buffer;
      transfer.receivedChunks += 1;
      transfer.loaded += buffer.byteLength;
      setReceiveProgress({
        name: transfer.meta.name,
        loaded: transfer.loaded,
        total: transfer.meta.size,
        percent: Math.round((transfer.loaded / transfer.meta.size) * 100),
      });
      return;
    }

    if (data.type === 'file-complete') {
      const transfer = receiveBuffersRef.current.get(data.fileId);
      if (!transfer) return;
      const blob = new Blob(transfer.chunks, { type: transfer.meta.mime });
      const url = URL.createObjectURL(blob);
      setReceivedFiles((items) => [
        {
          id: data.fileId,
          name: transfer.meta.name,
          size: transfer.meta.size,
          mime: transfer.meta.mime,
          senderName: transfer.meta.senderName || remoteName || 'Connected device',
          url,
          timestamp: Date.now(),
        },
        ...items,
      ]);
      receiveBuffersRef.current.delete(data.fileId);
      setStatus('complete');
      setInfo(`${transfer.meta.name} received. Click Download to save it.`);
      setTimeout(() => {
        setReceiveProgress(null);
        setStatus((current) => (current === 'complete' ? 'connected' : current));
      }, 1200);
    }
  }

  function removeReceivedFile(id) {
    setReceivedFiles((items) => {
      const target = items.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return items.filter((item) => item.id !== id);
    });
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const [file] = Array.from(event.dataTransfer.files || []);
    if (file) setSelectedFile(file);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="brand-mark">AT</div>
        <div>
          <p className="eyebrow">Awesome Toolset</p>
          <h1>LinkDrop</h1>
          <p className="subhead">
            Live browser-to-browser text and file sharing with WebRTC. No account, no stored files.
          </p>
        </div>
      </section>

      <section className="status-strip">
        <div className={`status-pill ${statusTone(status)}`}>
          {status === 'sending' || status === 'receiving' || status === 'joining' || status === 'creating' ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <Wifi size={16} />
          )}
          {CONNECTION_STATUSES[status]}
        </div>
        <div className="status-note">
          <ShieldAlert size={16} />
          Anyone with the active room code or link and a name can connect while this room is live.
        </div>
      </section>

      {(error || info) && (
        <div className={`notice ${error ? 'error' : 'info'}`}>
          {error ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{error || info}</span>
        </div>
      )}

      <section className="workspace">
        <aside className="panel connection-panel">
          <div className="mode-tabs">
            <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
              Create
            </button>
            <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
              Join
            </button>
          </div>

          {mode === 'create' ? (
            <div className="stack">
              <label className="field-label" htmlFor="creator-name">
                Your name
              </label>
              <input
                id="creator-name"
                className="text-input name-input"
                value={creatorName}
                placeholder="Eddie"
                onChange={(event) => setCreatorName(event.target.value)}
              />
              <label className="field-label" htmlFor="create-code">
                Room code
              </label>
              <div className="code-row">
                <input
                  id="create-code"
                  className="text-input"
                  value={createCode}
                  placeholder="ABC1234"
                  onChange={(event) => setCreateCode(normalizeRoomCode(event.target.value))}
                />
                <button className="icon-action" type="button" onClick={() => setCreateCode(randomRoomCode())}>
                  <RefreshCw size={16} />
                </button>
              </div>
              <button className="primary-action" onClick={createRoom}>
                <PlugZap size={18} />
                Create Room
              </button>
              <RoomCodeCard
                roomCode={roomCode}
                inviteLink={inviteLink}
                onCopy={copyInviteLink}
                copied={copiedInvite}
                hostName={creatorName}
                remoteName={remoteName}
              />
            </div>
          ) : (
            <div className="stack">
              {hasInviteCode && (
                <div className="join-found-card">
                  <span>Room found from invite link</span>
                  <strong>{joinCode}</strong>
                  <p>Tap Join Room to connect to the device that created this room.</p>
                </div>
              )}
              <label className="field-label" htmlFor="joiner-name">
                Your name
              </label>
              <input
                id="joiner-name"
                className="text-input name-input"
                value={joinerName}
                placeholder="Device B"
                onChange={(event) => setJoinerName(event.target.value)}
              />
              <label className="field-label" htmlFor="room-code">
                Room code
              </label>
              <input
                id="room-code"
                className="text-input"
                value={joinCode}
                placeholder="ABC1234"
                onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
              />
              <button className="primary-action" onClick={joinRoom}>
                <Smartphone size={18} />
                Join Room
              </button>
            </div>
          )}

          <button className="secondary-action" onClick={reconnect} disabled={mode === 'create' ? !creatorName || !createCode : !joinerName || !joinCode}>
            <RefreshCw size={16} />
            Reconnect
          </button>
        </aside>

        <section className="panel send-panel">
          <div className="panel-title">
            <h2>Send</h2>
            <p>Text and files move through the live peer connection.</p>
          </div>

          <textarea
            className="message-box"
            value={message}
            placeholder="Type text to send..."
            onChange={(event) => setMessage(event.target.value)}
          />
          <button className="primary-action" onClick={sendText} disabled={!canSend || !message.trim()}>
            <Send size={18} />
            Send Text
          </button>

          <div
            className={`drop-zone ${dragActive ? 'dragging' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <UploadCloud size={28} />
            <strong>{selectedFile ? selectedFile.name : 'Choose or drop a file'}</strong>
            <span>{selectedFile ? formatBytes(selectedFile.size) : 'Files up to 100MB+ depend on browser memory and network.'}</span>
            <input type="file" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
          </div>
          <button className="secondary-action" onClick={sendFile} disabled={!canSend || !selectedFile}>
            <FileUp size={18} />
            Send File
          </button>

          <ProgressCard title="Send progress" progress={sendProgress} />
          <ProgressCard title="Receive progress" progress={receiveProgress} />
        </section>

        <section className="panel receive-panel">
          <div className="panel-title">
            <h2>Received</h2>
            <p>Download files manually from this browser.</p>
          </div>

          <div className="received-group">
            <h3>Text</h3>
            {receivedTexts.length === 0 ? (
              <EmptyState label="No text received yet." />
            ) : (
              receivedTexts.map((item) => <TextCard key={item.id} item={item} onCopy={copyText} />)
            )}
          </div>

          <div className="received-group">
            <h3>Files</h3>
            {receivedFiles.length === 0 ? (
              <EmptyState label="No files received yet." />
            ) : (
              receivedFiles.map((file) => <FileCard key={file.id} file={file} onRemove={removeReceivedFile} />)
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function RoomCodeCard({ roomCode, inviteLink, onCopy, copied, hostName, remoteName }) {
  if (!roomCode) {
    return <div className="room-card muted">Add your name and room code, then create the room.</div>;
  }

  return (
    <div className="room-card">
      <span>Room code</span>
      <strong>{roomCode}</strong>
      <p className="room-meta">
        Host: {normalizeName(hostName) || 'You'}
        {remoteName ? ` - Connected with ${remoteName}` : ' - Waiting for another device'}
      </p>
      <div className="invite-line">
        <Link size={15} />
        <p>{inviteLink}</p>
      </div>
      <button className="secondary-action" onClick={onCopy}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? 'Copied' : 'Copy Invite Link'}
      </button>
    </div>
  );
}

function ProgressCard({ title, progress }) {
  if (!progress) return null;
  return (
    <div className="progress-card">
      <div>
        <strong>{title}</strong>
        <span>
          {progress.name} - {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
        </span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${progress.percent}%` }} />
      </div>
      <b>{progress.percent}%</b>
    </div>
  );
}

function TextCard({ item, onCopy }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await onCopy(item.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className="received-card">
      <p>{item.content}</p>
      <div className="card-actions">
        <time>
          {item.senderName || 'Connected device'} - {new Date(item.timestamp).toLocaleTimeString()}
        </time>
        <button onClick={handleCopy}>
          <Clipboard size={15} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </article>
  );
}

function FileCard({ file, onRemove }) {
  return (
    <article className="received-card file-card">
      <div>
        <strong>{file.name}</strong>
        <span>
          {formatBytes(file.size)} - {file.mime || 'file'} - from {file.senderName || 'Connected device'}
        </span>
      </div>
      <div className="card-actions">
        <a href={file.url} download={file.name}>
          <Download size={15} />
          Download
        </a>
        <button onClick={() => onRemove(file.id)} aria-label={`Remove ${file.name}`}>
          <X size={15} />
        </button>
      </div>
    </article>
  );
}

function EmptyState({ label }) {
  return <div className="empty-state">{label}</div>;
}

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app still works without the offline shell.
    });
  });
}
