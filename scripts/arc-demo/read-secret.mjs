// Hidden terminal input. Values are never printed or put in command-line args.
export function readSecret(prompt, input = process.stdin, output = process.stdout) {
  output.write(prompt + '\n');
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = input.isRaw;
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    function cleanup() {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      if (input.isTTY) input.setRawMode(Boolean(wasRaw));
      input.pause();
    }
    function onEnd() { cleanup(); reject(new Error('Secret input ended.')); }
    function onData(chunk) {
      for (const character of chunk.toString()) {
        if (character === '\u0003') { cleanup(); reject(new Error('Cancelled.')); return; }
        if (character === '\r' || character === '\n') { cleanup(); resolve(value.trim()); return; }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    }
    input.on('data', onData);
    input.once('end', onEnd);
  });
}
