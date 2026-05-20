# Awesome Toolset - LinkDrop

LinkDrop is a browser-based device-to-device text and file sharing app. It uses PeerJS for lightweight WebRTC signaling and sends the actual text and file bytes directly between browsers over WebRTC DataChannels.

There is no login, database, file storage, Firebase, Supabase, cloud bucket, or custom file backend.

## Features

- Create a room with creator name and short room code
- Join by name plus room code or `?room=ROOM_CODE` invite link
- Send plain text both ways
- Copy received text
- Send files both ways with chunked transfer
- Sender and receiver progress bars
- Manual browser download links for received files
- Connection status, errors, and reconnect action
- Responsive light-mode Apple-inspired UI
- PWA manifest and service worker for installable app behavior

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open the local URL printed by Vite. To test between two devices on the same LAN, open the Network URL on the second device. For devices on different networks, deploy the app to Vercel, Netlify, or GitHub Pages and open the deployed URL on both devices.

## Build

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deploy

### Vercel

1. Push the repo to GitHub.
2. Import the repo in Vercel.
3. Use the default Vite settings:
   - Build command: `npm run build`
   - Output directory: `dist`

### Netlify

1. Push the repo to GitHub.
2. Import the repo in Netlify.
3. Use:
   - Build command: `npm run build`
   - Publish directory: `dist`

### GitHub Pages

For a project page, set Vite `base` to your repository path if needed, run `npm run build`, and publish the `dist` folder using your preferred GitHub Pages workflow.

## How to use between two devices

1. Open the app on Device A.
2. Enter the creator name and a room code. You can type your own code or use the generate button.
3. Click **Create Room**.
4. Share the room code or invite link with Device B.
5. Open the app on Device B.
6. Enter the joining user's name and the exact room code. If Device B opens the invite link, it will show a room-found card with the code filled in.
7. Tap **Join Room**.
8. Once the status is **Connected**, either device can send text or choose a file.
9. Received files appear as download links. Click **Download** to save them.

Both devices must remain online and connected at the same time. The room code validates access by matching the joiner to the live peer room. Anyone with the active room code or invite link and a name can connect while the room is active.

## How WebRTC works here

PeerJS provides signaling so the two browsers can find each other and negotiate a WebRTC connection. After the connection is established, LinkDrop uses a WebRTC DataChannel to send JSON control messages, text messages, and file chunks directly between the browsers.

The public PeerJS signaling server helps with pairing only. It is not used as file storage.

By default the app uses PeerJS Cloud at `0.peerjs.com`. You can point it at your own PeerJS signaling server with:

```bash
VITE_PEER_HOST=your-peer-server.example.com
VITE_PEER_PORT=443
VITE_PEER_PATH=/
VITE_PEER_SECURE=true
```

## Why no file storage is needed

Files are read in the sending browser, split into chunks, and sent through the DataChannel. The receiving browser reconstructs those chunks into a `Blob` and creates a temporary `URL.createObjectURL` download link. Nothing is uploaded to a storage server by this app.

## Why files cannot be auto-saved

Browsers do not allow websites to silently save arbitrary files into a user's folders. This is a privacy and security protection. LinkDrop can create a download link, but the receiving user must click **Download** or approve a browser save action.

## Known limitations

- Receiver must be online and connected.
- This is live transfer only, not offline storage.
- If WebRTC fails on strict networks, a TURN server may be needed.
- Browser cannot automatically save files into a folder; user must click Download.
- Large files depend on browser memory and network stability.
- Some mobile browsers may restrict clipboard or file download behavior.
- The public PeerJS signaling service is convenient for demos; production use may benefit from a dedicated PeerJS signaling server and TURN configuration.
