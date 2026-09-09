// Programmatic full-voice E2E: simulates a browser participant speaking to Nana
// over the local LiveKit + Agent OS + OpenAI Realtime stack.
// Usage: node --import tsx voice-e2e.mjs "Nana, cómo está el Bitcoin?"
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = '/Users/ramiro/Desktop/projects/personales/binance_hackatho.feat-binance-agent-os-trackA';
const envFile = `${root}/.env`;
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\\n/g, '\n');
}
const API = 'http://localhost:3000';
const userId = process.env.DEMO_USER_ID;
const phrase = process.argv[2] ?? 'Nana, cómo está el Bitcoin?';

const m = await import('@livekit/rtc-node');
const { Room, RoomEvent, AudioSource, LocalAudioTrack, AudioFrame } = m;

// --- 1) create conversation + binding ---
const convRes = await fetch(`${API}/v1/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
const { conversationId } = await convRes.json();
const bindRes = await fetch(`${API}/v1/live-bindings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId }) });
const binding = await bindRes.json();
if (!binding.bindingToken) throw new Error('binding failed: ' + JSON.stringify(binding));
console.log('[e2e] conversation:', conversationId, '| binding ok');

// --- 2) room credentials (room name must match the binding conversation) ---
const credRes = await fetch(`${API}/v1/livekit/connection-details`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room_name: `nani-${conversationId}`, participant_identity: userId, agent_name: 'nani-agent' }) });
const creds = await credRes.json();
console.log('[e2e] room:', creds.room_name, '| server:', creds.server_url);

// --- 3) TTS the user utterance (OpenAI) ---
const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: phrase, response_format: 'wav' }),
});
if (!ttsRes.ok) throw new Error('TTS failed: ' + (await ttsRes.text()).slice(0, 120));
const ttsWav = Buffer.from(await ttsRes.arrayBuffer());
writeFileSync('/tmp/voice-e2e-user.wav', ttsWav);
console.log('[e2e] TTS user phrase:', (ttsWav.length / 48000 / 4).toFixed(1), 's approx');

// --- 4) connect + publish + bind ---
const room = new Room({ adaptiveStream: true, dynacast: true });
const agentAudioChunks = [];
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  if (track.kind !== 1) return; // audio
  console.log('[e2e] agent audio subscribed from', participant?.identity);
  const stream = new m.AudioStream(track, { mode: m.AudioStream.Mode.CAPTURE });
  void (async () => {
    for await (const frame of stream) {
      agentAudioChunks.push(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
    }
  })();
});
room.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
  if (changed['lk.agent.state']) console.log('[e2e] agent state:', changed['lk.agent.state']);
});
room.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
  if (topic === 'conversation_state_changed') console.log('[e2e] state revision published:', new TextDecoder().decode(payload));
});
await room.connect(creds.server_url, creds.participant_token, { autoSubscribe: true });
console.log('[e2e] connected to room');

const source = new AudioSource(48000, 1);
const track = LocalAudioTrack.createAudioTrack('mic-e2e', source);
await room.localParticipant.publishTrack(track, { source: m.TrackSource.SOURCE_MICROPHONE });

// wait for the agent participant
let agent;
for (let i = 0; i < 120; i++) {
  agent = Object.values(room.remoteParticipants ?? {})[0];
  if (agent) break;
  await new Promise(r => setTimeout(r, 500));
}
console.log('[e2e] agent present:', agent?.identity ?? 'NOT YET');

const rpc = await room.localParticipant.performRpc({
  destinationIdentity: agent.identity,
  method: 'bind_conversation',
  payload: JSON.stringify({ bindingToken: binding.bindingToken }),
  responseTimeout: 10000,
});
console.log('[e2e] bind_conversation:', String(rpc).slice(0, 120));

// --- 5) stream the TTS audio as mic frames ---
function decodeWavPcm(buf) {
  // find data chunk
  let off = 12;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return { data: buf.subarray(off + 8, off + 8 + size) };
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}
const { data } = decodeWavPcm(ttsWav);
const inRate = 24000, outRate = 48000;
const inSamples = data.length / 2;
const outSamples = Math.floor(inSamples * outRate / inRate);
const out = new Int16Array(outSamples);
for (let i = 0; i < outSamples; i++) {
  const srcIdx = Math.floor(i * inRate / outRate) * 2;
  out[i] = data.readInt16LE(Math.min(srcIdx, data.length - 2));
}
const samplesPerFrame = 480; // 10ms @48k
for (let off = 0; off < out.length; off += samplesPerFrame) {
  const chunk = out.subarray(off, Math.min(off + samplesPerFrame, out.length));
  const frame = new AudioFrame(chunk, 48000, 1, chunk.length);
  source.captureFrame(frame);
}
console.log('[e2e] audio streamed; waiting for the agent turn...');
await new Promise(r => setTimeout(r, 12000));

// --- 6) verify via canonical state ---
const stateRes = await fetch(`${API}/v1/conversations/${conversationId}/state`);
const state = (await stateRes.json()).data ?? (await stateRes.json());
const messages = (state.messages ?? []).map(x => `${x.role}: ${String(x.content).slice(0, 120)}`);
console.log('[e2e] conversation messages:', JSON.stringify(messages).slice(0, 500));
console.log('[e2e] pendingTransfer:', state.pendingTransfer ? 'PRESENT' : 'none');

// --- 7) save the agent audio for inspection ---
if (agentAudioChunks.length) {
  const raw = Buffer.concat(agentAudioChunks);
  writeFileSync('/tmp/voice-e2e-agent.raw', raw);
  console.log('[e2e] agent audio captured:', raw.length, 'bytes (', agentAudioChunks.length, 'frames ) — /tmp/voice-e2e-agent.raw');
} else {
  console.log('[e2e] NO agent audio captured');
}
writeFileSync('/tmp/voice-e2e-conversation.json', JSON.stringify({ conversationId, ...state }, null, 2));
await room.disconnect();
process.exit(0);
