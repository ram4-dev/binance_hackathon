let state;
let csrf;
let busy = false;
let lastMessage;
const el = id => document.getElementById(id);
const phases = { idle: 'Sin preparar', preview: 'Revisar y confirmar', submitting: 'Enviando', submitted: 'Verificando', confirmed: 'Confirmado', cancelled: 'Cancelado', uncertain: 'Por verificar', rejected: 'Requiere revisión' };

function bubble(text, role = 'nani') {
  const item = document.createElement('p');
  item.className = 'bubble ' + role;
  item.textContent = text;
  el('messages').append(item);
  el('messages').scrollTop = el('messages').scrollHeight;
}
function paint(data, speak = true) {
  state = data;
  if (data.csrf) csrf = data.csrf;
  el('connection').textContent = 'Conectada';
  el('sender').textContent = data.sender;
  el('recipient').textContent = data.recipient;
  el('balance').textContent = data.balance === null ? 'Consultá el saldo' : data.balance + ' USDC';
  el('fee').textContent = data.estimatedFee === null ? 'Se calcula en el preview' : data.estimatedFee + ' USDC';
  el('phase').textContent = phases[data.phase] || data.phase;
  el('actions').hidden = data.phase !== 'preview';
  el('proof').hidden = !data.hash;
  if (data.hash) {
    el('hash').textContent = data.hash;
    el('proof-label').textContent = data.phase === 'confirmed' ? 'Confirmada onchain' : 'Hash disponible, verificando';
    el('explorer').href = data.explorer;
  }
  if (speak && data.message && data.message !== lastMessage) {
    bubble(data.message);
    lastMessage = data.message;
  }
}
async function send(text) {
  if (busy || !csrf || !text.trim()) return;
  busy = true;
  document.querySelectorAll('button').forEach(button => button.disabled = true);
  bubble(text, 'user');
  el('message').value = '';
  try {
    const response = await fetch('/api/message', { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-token': csrf }, body: JSON.stringify({ text, previewId: state.previewId }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No pude completar la consulta.');
    paint(data);
  } catch {
    bubble('No pude obtener el resultado. Consultá verificar antes de repetir un envío.');
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach(button => button.disabled = false);
  }
}
el('composer').addEventListener('submit', event => { event.preventDefault(); void send(el('message').value); });
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => void send(button.dataset.command)));
el('confirm').addEventListener('click', () => void send('confirmar'));
el('cancel').addEventListener('click', () => void send('cancelar'));
async function refresh() {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('Connection unavailable.');
  paint(await response.json());
}
refresh().catch(() => { el('connection').textContent = 'Sin conexión'; bubble('No pude conectar con el backend local.'); });
setInterval(() => {
  if (!busy && ['submitted', 'uncertain'].includes(state?.phase)) {
    busy = true;
    refresh().catch(() => { el('connection').textContent = 'Reconectando...'; }).finally(() => { busy = false; });
  }
}, 2500);
