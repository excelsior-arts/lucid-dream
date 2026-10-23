/* The models panel: three sections, what is here and in use, one total and
   one request for everything there is to download. */
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, test, vi} from 'vitest';
import {MACHINE, PAGE, setHost} from '@lucid/shell';

const machine = vi.hoisted(() => ({facts: {} as unknown, asked: [] as unknown[], forgot: [] as unknown[],
                                   hangs: false, reads: 0}));
vi.mock('@lucid/machine', () => ({
  status: () => {
    machine.reads += 1;
    return machine.hangs ? new Promise(() => {}) : Promise.resolve(machine.facts);
  },
  models: {fetchAll: (o: unknown) => { machine.asked.push(o); return Promise.resolve({}); }},
  heedShelf: () => Promise.resolve(),
  forgetModel: (part: string, id: string, o: {dry?: boolean} = {}) => {
    machine.forgot.push([part, id, !!o.dry]);
    return Promise.resolve({bytes: 437_000_000, files: 5});
  },
}));
const {default: ModelCard, SILENT_MS} = await import('./ModelCard');

afterEach(() => {
  cleanup();
  setHost(MACHINE);
  machine.asked.length = 0;
  machine.forgot.length = 0;
  machine.hangs = false;
  machine.reads = 0;
  vi.useRealTimers();
});

const offer = (sizes: Array<[string, number, boolean]>) =>
  sizes.map(([size, gb, suggested]) => ({size, repo: `org/${size}`, gb, here: false, suggested}));

test('a Mac with nothing on its shelf is offered the words, the voice and the ear, ticked, in one total', async () => {
  machine.facts = {
    status: {llm: 'absent'},
    llm: {here: false, size: 'lg', ram_gb: 48, offer: offer([['sm', 3.1, false], ['md', 6, false], ['lg', 16.1, true]]), fetch: null},
    shelf: {voice: [{id: 'tts', name: 'Chatterbox Turbo', gb: 3, here: false, suggested: true}],
            ear: [{id: 'stt', name: 'Parakeet', gb: 2.5, here: false, suggested: true}], fetch: null},
  };
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={() => {}} />); });
  expect(await screen.findByText('Chatterbox Turbo')).toBeInTheDocument();
  expect(screen.getByText('Parakeet')).toBeInTheDocument();
  // Each section says how much it matters; the smallest size is the minimum.
  for (const need of ['required', 'recommended', 'optional']) {
    expect(screen.getByText(need, {selector: '.model-need'})).toBeInTheDocument();
  }
  expect(screen.getByRole('radio', {name: /4B.*minimum/})).toBeInTheDocument();
  expect(screen.getByRole('radio', {name: /27B.*recommended for 48 GB/})).toBeChecked();
  expect(screen.getByText(/22 GB in all/)).toBeInTheDocument();
  // A machine that only reads and types: the ear left out.
  fireEvent.click(screen.getByRole('checkbox', {name: /Parakeet/}));
  expect(screen.getByText(/19 GB in all/)).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByText('Download')); });
  expect(machine.asked).toEqual([{size: 'lg', voice: 'tts'}]);
});

test('opened for the voice on a Mac with its model, only the voice comes down', async () => {
  machine.facts = {
    status: {llm: 'ready'},
    llm: {here: true, size: 'lg', ram_gb: 48, offer: [{size: 'lg', repo: 'o/lg', gb: 16.1, here: true, suggested: true}], fetch: null},
    shelf: {voice: [{id: 'tts', name: 'Chatterbox Turbo', gb: 3, here: false, suggested: true}],
            ear: [{id: 'stt', name: 'Parakeet', gb: 2.5, here: true, suggested: true}], fetch: null},
  };
  await act(async () => { render(<ModelCard focus="voice" onReady={() => {}} onLeave={() => {}} />); });
  expect(await screen.findByText(/3\.0 GB in all/)).toBeInTheDocument();
  // The ear is here already: listed, with nothing to tick.
  expect(screen.getByText('Parakeet')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', {name: /Parakeet/})).toBeNull();
  await act(async () => { fireEvent.click(screen.getByText('Download')); });
  expect(machine.asked).toEqual([{voice: 'tts'}]);
});

test('a browser is offered its engines, Turbo suggested, or no voice at all', async () => {
  setHost({...PAGE, llm: 'page', machine: false});
  machine.facts = {
    status: {llm: 'off'},
    llm: {here: false, size: '', offer: offer([['0.8b', 0.45, false], ['2b', 1.08, true]]), fetch: null},
    shelf: {voice: [{id: 'turbo', name: 'Chatterbox Turbo', gb: 0.647, here: false, suggested: true},
                    {id: 'sopro', name: 'Sopro v2 Turbo', gb: 0.362, here: false, suggested: false}],
            ear: [], fetch: null},
  };
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={() => {}} />); });
  expect(await screen.findByText('No voice')).toBeInTheDocument();
  expect(screen.getByText(/1\.7 GB in all/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', {name: /No voice/}));
  expect(screen.getByText(/1\.1 GB in all/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', {name: /Sopro/}));
  await act(async () => { fireEvent.click(screen.getByText('Download')); });
  expect(machine.asked).toEqual([{size: '2b', voice: 'sopro'}]);
});

const everything = () => ({
  status: {llm: 'ready'},
  llm: {here: true, size: 'lg', ram_gb: 48, fetch: null,
        offer: [{size: 'sm', repo: 'o/sm', gb: 3.1, here: false, suggested: false},
                {size: 'md', repo: 'o/md', gb: 6, here: true, suggested: false},
                {size: 'lg', repo: 'o/lg', gb: 16.1, here: true, suggested: true}]},
  shelf: {voice: [{id: 'tts', name: 'Chatterbox Turbo', gb: 3, here: true, suggested: true}],
          ear: [{id: 'stt', name: 'Parakeet', gb: 2.5, here: true, suggested: true}], fetch: null},
});

test('from the gear, a Mac with everything sees it all here and nothing to do', async () => {
  machine.facts = everything();
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={() => {}} />); });
  expect(await screen.findByText(/Everything it needs is downloaded/)).toBeInTheDocument();
  expect(screen.getByRole('radio', {name: /27B.*in use/})).toBeChecked();
  expect(screen.getByRole('radio', {name: /4B.*not downloaded/})).toBeInTheDocument();
  expect(screen.queryByText('Download')).toBeNull();
  expect(screen.getByText('Close')).toBeInTheDocument();
});

test('a size that is here is put in use; one that is not is downloaded', async () => {
  machine.facts = everything();
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={() => {}} />); });
  fireEvent.click(await screen.findByRole('radio', {name: /9B/}));
  expect(screen.queryByText(/in all/)).toBeNull();
  await act(async () => { fireEvent.click(screen.getByText('Use it')); });
  expect(machine.asked).toEqual([{size: 'md'}]);
  fireEvent.click(screen.getByRole('radio', {name: /4B/}));
  expect(screen.getByText(/3\.1 GB in all/)).toBeInTheDocument();
});

test('a browser with its model and a voice in use shows them, and can turn the voice off', async () => {
  setHost({...PAGE, llm: 'page', machine: false});
  machine.facts = {
    status: {llm: 'off'},
    llm: {here: true, size: '2b', fetch: null,
          offer: [{size: '0.8b', repo: 'o/a', gb: 0.45, here: false, suggested: false},
                  {size: '2b', repo: 'o/b', gb: 1.08, here: true, suggested: true}]},
    shelf: {voice: [{id: 'turbo', name: 'Chatterbox Turbo', gb: 0.647, here: false, suggested: true},
                    {id: 'sopro', name: 'Sopro v2 Turbo', gb: 0.362, here: true, suggested: false, using: true}],
            ear: [{id: 'moonshine', name: 'Moonshine Base', gb: 0.067, here: false, suggested: true}],
            fetch: null},
  };
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={() => {}} />); });
  expect(await screen.findByRole('radio', {name: /Sopro.*in use/})).toBeChecked();
  expect(screen.getByRole('radio', {name: /2B.*in use/})).toBeChecked();
  // The ear is offered and not ticked: it is optional, and typing is enough.
  expect(screen.getByRole('radio', {name: /Moonshine.*not downloaded/})).not.toBeChecked();
  expect(screen.getByRole('radio', {name: /No microphone.*typing only/})).toBeChecked();
  expect(screen.queryByText(/not in the browser version/)).toBeNull();
  expect(screen.getByText('Close')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', {name: /No voice/}));
  await act(async () => { fireEvent.click(screen.getByText('Use it')); });
  expect(machine.asked).toEqual([{voice: ''}]);
});

test('a browser reaching for the microphone is offered its ear ticked, and brings it down alone', async () => {
  setHost({...PAGE, llm: 'page', machine: false, ear: true});
  machine.facts = {
    status: {llm: 'ready'},
    llm: {here: true, size: '2b', fetch: null,
          offer: [{size: '2b', repo: 'o/b', gb: 1.08, here: true, suggested: true}]},
    shelf: {voice: [],
            ear: [{id: 'moonshine', name: 'Moonshine Base', gb: 0.067, here: false, suggested: true},
                  {id: 'parakeet', name: 'Parakeet', gb: 0.661, here: false, suggested: false}],
            fetch: null},
  };
  await act(async () => { render(<ModelCard focus="ear" onReady={() => {}} onLeave={() => {}} />); });
  expect(await screen.findByRole('radio', {name: /Moonshine.*recommended/})).toBeChecked();
  expect(screen.getByText(/Nothing you say\s+leaves this browser/)).toBeInTheDocument();
  // On the processor, not the GPU: nothing to keep free there for it.
  expect(screen.getByText('67 MB in all')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByText('Download')); });
  expect(machine.asked).toEqual([{ear: 'moonshine'}]);
});

test('a browser deletes what is here and not in use, asking first with what it frees', async () => {
  setHost({...PAGE, llm: 'page', machine: false});
  machine.facts = {
    status: {llm: 'ready'},
    llm: {here: true, size: '2b', fetch: null,
          offer: [{size: '0.8b', repo: 'o/a', gb: 0.45, here: true, suggested: false},
                  {size: '2b', repo: 'o/b', gb: 1.08, here: true, suggested: true},
                  {size: '4b', repo: 'o/c', gb: 2.39, here: false, suggested: false}]},
    shelf: {voice: [{id: 'turbo', name: 'Chatterbox Turbo', gb: 0.647, here: true, suggested: true},
                    {id: 'sopro', name: 'Sopro v2 Turbo', gb: 0.362, here: true, suggested: false, using: true}],
            ear: [{id: 'moonshine', name: 'Moonshine Base', gb: 0.067, here: true, suggested: true}],
            fetch: null},
  };
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={() => {}} />); });
  await screen.findByRole('radio', {name: /2B.*in use/});
  // A delete on each row that is here and not in use; none on the 2B and
  // Sopro in use, none on the 4B that is not here.
  const deletes = screen.getAllByRole('button', {name: /^Delete .* from this browser$/}).map((b) => b.getAttribute('aria-label'));
  expect(deletes).toEqual(['Delete Qwen3.5 0.8B from this browser', 'Delete Chatterbox Turbo from this browser',
    'Delete Moonshine Base from this browser']);
  // Pressing the row's delete is not choosing the row.
  fireEvent.click(screen.getByRole('button', {name: 'Delete Qwen3.5 0.8B from this browser'}));
  expect(screen.getByRole('radio', {name: /2B/})).toBeChecked();
  // The foot asks, with what the cache says it frees.
  expect(await screen.findByText(/Delete Qwen3\.5 0\.8B from this browser\? It frees 437 MB/)).toBeInTheDocument();
  expect(machine.forgot).toEqual([['llm', '0.8b', true]]);
  fireEvent.click(screen.getByText('Keep it'));
  expect(screen.queryByText(/It frees/)).toBeNull();
  expect(machine.forgot).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', {name: 'Delete Chatterbox Turbo from this browser'}));
  await screen.findByText(/It frees 437 MB/);
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Delete'})); });
  expect(machine.forgot.at(-1)).toEqual(['voice', 'turbo', false]);
  expect(screen.queryByText(/It frees/)).toBeNull();
});

test('a Mac\'s rows have no delete', async () => {
  machine.facts = everything();
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={() => {}} />); });
  await screen.findByText(/Everything it needs is downloaded/);
  expect(screen.queryAllByRole('button', {name: /^Delete/})).toEqual([]);
});

test('a machine that never answers: not the dots for good, and not asked again on top of itself', async () => {
  vi.useFakeTimers();
  setHost({...PAGE, llm: 'page', machine: false});
  machine.hangs = true;
  const left = vi.fn();
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={left} />); });
  expect(screen.getByText('…')).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(SILENT_MS); });
  expect(screen.queryByText('…')).toBeNull();
  expect(screen.getByText(/This browser did not say which models it holds in 10 seconds/)).toBeInTheDocument();
  // One read outstanding the whole time, not one more every tick.
  expect(machine.reads).toBe(1);
  fireEvent.click(screen.getByText('Close'));
  expect(left).toHaveBeenCalled();
});

/* The iPhone Air's, 10-10: the words and Turbo asked for together. */
const phone = (words: string, voice: Record<string, unknown>) => ({
  status: {llm: words === 'done' ? 'ready' : 'loading', tts: 'error'},
  llm: {here: words === 'done', size: words === 'done' ? '0.8b' : '',
        fetch: {size: '0.8b', state: words, got_gb: words === 'done' ? 0.45 : 0.2, gb: 0.45},
        offer: [{size: '0.8b', repo: 'o/a', gb: 0.45, here: words === 'done', suggested: true},
                {size: '2b', repo: 'o/b', gb: 1.08, here: false, suggested: false}]},
  shelf: {voice: [{id: 'turbo', name: 'Chatterbox Turbo', gb: 0.699, here: false, suggested: false, using: true,
                   error: 'this device ran out of memory starting it'},
                  {id: 'sopro', name: 'Sopro v2 Turbo', gb: 0.362, here: false, suggested: true}],
          ear: [], fetch: {state: 'error', got_gb: 0, gb: 0.699, error: 'this device ran out of memory starting it', ...voice}},
});

test('the words up and the voice failed: its row says why in plain words, and the words are one press away', async () => {
  setHost({...PAGE, llm: 'page', machine: false});
  machine.facts = phone('fetching', {state: 'fetching'});
  const ready = vi.fn();
  await act(async () => { render(<ModelCard onReady={ready} onLeave={() => {}} />); });
  // Opened while the words come down: shown as under way, not offered again.
  expect(await screen.findByText(/downloading/)).toBeInTheDocument();
  expect(screen.getByRole('radio', {name: /0\.8B/})).toBeDisabled();
  machine.facts = phone('done', {});
  await act(async () => { await new Promise((go) => setTimeout(go, 800)); });
  // Turbo's row: failed, why, and what to try; Sopro is now the one offered.
  expect(screen.getByRole('radio', {name: /Chatterbox Turbo.*failed/})).toBeInTheDocument();
  expect(screen.getByText(/Did not start here: this device ran out of memory starting it\. Try Sopro v2 Turbo, or No voice\./))
    .toBeInTheDocument();
  expect(screen.getByRole('radio', {name: /^Sopro/})).toBeChecked();
  expect(screen.getByText(/The words are ready: go on without it, or choose another voice/)).toBeInTheDocument();
  expect(screen.queryByText(/backend|RangeError/)).toBeNull();
  expect(ready).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Go on without it'));
  expect(ready).toHaveBeenCalled();
});

test('a size the storage did not answer for is said so, not called missing', async () => {
  setHost({...PAGE, llm: 'page', machine: false});
  machine.facts = {
    status: {llm: 'off'},
    llm: {here: false, size: '', fetch: null,
          offer: [{size: '0.8b', repo: 'o/a', gb: 0.45, here: false, suggested: true, unknown: true}]},
    shelf: {voice: [], ear: [], fetch: null},
  };
  await act(async () => { render(<ModelCard onReady={() => {}} onLeave={() => {}} />); });
  expect(await screen.findByRole('radio', {name: /0\.8B.*not checked/})).toBeInTheDocument();
});
