import { useCallback, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import {
	BAD_PC,
	BYTECODE,
	DMESG,
	JIT,
	LKM_CHECKS,
	OBJDUMP,
	PROGS,
	RELOCS,
	STEP_LABELS,
	TRACE,
	VERDICT,
	caption,
	source,
	type Line,
	type Mode,
	type Prog,
} from './programs';
import './KernelPipeline.css';

/* ------------------------------------------------------------- geometry */

type Pt = [number, number];
interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

const W = 580;
const H = 330;
const BOUNDARY = 124;
const BW = 130;
const BH = 46;
const box = (x: number, y: number): Rect => ({ x, y, w: BW, h: BH });

const BOX = {
	src: box(20, 36),
	obj: box(215, 36),
	loader: box(410, 36),
	hook: box(20, 160),
	jit: box(215, 160),
	verifier: box(410, 160),
	procs: box(20, 256),
	map: box(410, 256),
} as const;
type BoxName = keyof typeof BOX;

const PATH: Record<string, Pt[]> = {
	compile: [
		[150, 59],
		[215, 59],
	],
	ship: [
		[345, 59],
		[410, 59],
	],
	load: [
		[455, 82],
		[455, 160],
	],
	reject: [
		[500, 160],
		[500, 82],
	],
	verified: [
		[410, 183],
		[345, 183],
	],
	attach: [
		[215, 183],
		[150, 183],
	],
	event: [
		[85, 256],
		[85, 206],
	],
	record: [
		[150, 196],
		[182, 196],
		[182, 279],
		[410, 279],
	],
	read: [
		[540, 279],
		[562, 279],
		[562, 59],
		[540, 59],
	],
};

const pathD = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');

function along(pts: Pt[], t: number): Pt {
	t = Math.min(1, Math.max(0, t));
	const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
	let d = t * lens.reduce((a, b) => a + b, 0);
	for (let i = 0; i < lens.length; i++) {
		if (d <= lens[i]) {
			const f = lens[i] ? d / lens[i] : 0;
			return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
		}
		d -= lens[i];
	}
	return pts[pts.length - 1];
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Progress of `p` through the window [a, b], eased. */
const win = (p: number, a: number, b: number) => ease(clamp01((p - a) / (b - a)));

/* --------------------------------------------------------------- timing */

const STEP_MS = [2600, 2600, 2400, 5600, 3000, 2200, Infinity];
const RUN_STEP = 6;
const VERIFY_STEP = 3;
const VERDICT_AT = 0.86; // fraction of the verify step after which the verdict is in

// Run-step event lifecycle, in ms from the event's birth.
const EV_TO_HOOK = 550;
const EV_IN_HOOK = 250;
const EV_TO_MAP = 650;
const READ_EVERY = 1700;
const READ_MS = 750;
const LOCKUP_REPORT_MS = 1400;

const COMMS = ['bash', 'curl', 'ls', 'git', 'node', 'cron', 'ssh', 'make', 'ls', 'git', 'cat', 'ls'];

/* ------------------------------------------------------------ simulation */

interface Ev {
	id: number;
	comm: string;
	pid: number;
	t0: number;
}
interface Read {
	t0: number;
	snapshot?: Record<string, number>;
}
interface Sim {
	events: Ev[];
	reads: Read[];
	counts: Record<string, number>;
	seen: Record<string, number>; // what user space has read so far
	nextSpawn: number;
	nextRead: number;
	nextId: number;
	lastComm: string | null;
	crash: { t: number; comm: string; pid: number } | null;
}

const freshSim = (): Sim => ({
	events: [],
	reads: [],
	counts: {},
	seen: {},
	nextSpawn: 300,
	nextRead: READ_EVERY,
	nextId: 0,
	lastComm: null,
	crash: null,
});

/* ------------------------------------------------------------- component */

/**
 * Step-through diagram of getting code into the kernel, either as an eBPF program or as a
 * kernel module. The post shows one of each, so `mode` is fixed per instance.
 */
export default function KernelPipeline({ mode }: { mode: Mode }) {
	const [prog, setProg] = useState<Prog>('ok');
	// Two diagrams share the page, so SVG ids must be unique per instance.
	const arrowId = `kp-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
	const [step, setStep] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [, frame] = useReducer((n: number) => n + 1, 0);

	const elapsed = useRef(0); // ms into the current step
	const sim = useRef<Sim>(freshSim());
	const rootRef = useRef<HTMLElement>(null);
	const visible = useRef(false);
	const autoplayed = useRef(false);
	const reducedMotion = useRef(false);

	const rejects = mode === 'ebpf' && prog !== 'ok';
	const lastStep = rejects ? VERIFY_STEP : RUN_STEP;
	const p = step === RUN_STEP ? 1 : clamp01(elapsed.current / STEP_MS[step]);
	const rejected = rejects && step === VERIFY_STEP && p >= VERDICT_AT;
	const crash = step === RUN_STEP ? sim.current.crash : null;

	const goto = useCallback((s: number) => {
		elapsed.current = 0;
		sim.current = freshSim();
		setStep(s);
	}, []);

	const reset = (pr: Prog) => {
		setProg(pr);
		goto(0);
		if (!reducedMotion.current) setPlaying(true);
	};

	// Autoplay once when the figure first scrolls into view; pause whenever it is off screen.
	useEffect(() => {
		reducedMotion.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const io = new IntersectionObserver(
			([e]) => {
				visible.current = e.isIntersecting;
				if (e.isIntersecting && !autoplayed.current) {
					autoplayed.current = true;
					if (!reducedMotion.current) setPlaying(true);
				}
				frame();
			},
			{ threshold: 0.35 },
		);
		if (rootRef.current) io.observe(rootRef.current);
		return () => io.disconnect();
	}, []);

	const spawn = useCallback((t: number) => {
		const s = sim.current;
		const comm = COMMS[s.nextId % COMMS.length];
		s.events.push({ id: s.nextId++, comm, pid: 4000 + Math.floor(Math.random() * 900), t0: t });
		s.lastComm = comm;
	}, []);

	const tickRun = useCallback(
		(t: number) => {
			const s = sim.current;
			if (s.crash) return;
			if (t >= s.nextSpawn) {
				spawn(t);
				s.nextSpawn = t + 750 + Math.random() * 700;
			}
			for (const ev of s.events) {
				if (t >= ev.t0 + EV_TO_HOOK && mode === 'lkm' && prog !== 'ok') {
					s.crash = { t: ev.t0 + EV_TO_HOOK, comm: ev.comm, pid: ev.pid };
					return;
				}
			}
			s.events = s.events.filter((ev) => {
				if (t < ev.t0 + EV_TO_HOOK + EV_IN_HOOK + EV_TO_MAP) return true;
				s.counts[ev.comm] = (s.counts[ev.comm] ?? 0) + 1;
				return false;
			});
			if (t >= s.nextRead) {
				s.reads.push({ t0: t });
				s.nextRead = t + READ_EVERY;
			}
			s.reads = s.reads.filter((r) => {
				if (t < r.t0 + READ_MS) return true;
				s.seen = { ...s.counts };
				return false;
			});
		},
		[mode, prog, spawn],
	);

	// The clock. Runs only while playing and on screen.
	useEffect(() => {
		if (!playing) return;
		let last = performance.now();
		let raf = 0;
		const loop = (now: number) => {
			const dt = Math.max(0, Math.min(now - last, 100));
			last = now;
			if (visible.current) {
				elapsed.current += dt;
				if (step === RUN_STEP) tickRun(elapsed.current);
				else if (elapsed.current >= STEP_MS[step]) {
					if (step < lastStep) {
						elapsed.current = 0;
						setStep(step + 1);
					} else {
						elapsed.current = STEP_MS[step];
						setPlaying(false);
					}
				}
				frame();
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [playing, step, lastStep, tickRun]);

	const runCommand = () => {
		if (step !== RUN_STEP || sim.current.crash) return;
		spawn(elapsed.current);
		if (!playing) setPlaying(true);
	};

	const reboot = () => {
		goto(RUN_STEP);
		setPlaying(true);
	};

	const togglePlay = () => {
		if (!playing && step === lastStep && step !== RUN_STEP && p >= 1) goto(0);
		setPlaying(!playing);
	};

	/* ---------------------------------------------------------- box state */

	const ORDER: Record<BoxName, number> = { src: 0, obj: 1, loader: 2, verifier: 3, jit: 4, hook: 5, procs: 6, map: 6 };
	const boxState = (name: BoxName): string => {
		if (name === 'verifier' && rejected) return 'bad';
		if (name === 'hook' && crash) return 'bad';
		if (rejects && ORDER[name] > VERIFY_STEP) return 'dim';
		if (step === RUN_STEP && (name === 'loader' || ORDER[name] >= 5)) return 'active';
		if (ORDER[name] === step) return 'active';
		if (ORDER[name] < step) return 'done';
		return 'pending';
	};

	const label = (name: BoxName): [string, string] => {
		const s = sim.current;
		const entries = Object.keys(step === RUN_STEP ? s.counts : {}).length;
		const ebpf = mode === 'ebpf';
		switch (name) {
			case 'src':
				return ebpf ? ['count.bpf.c', 'restricted C'] : ['counter.c', 'plain C'];
			case 'obj':
				return ebpf ? ['count.bpf.o', 'BPF bytecode'] : ['counter.ko', 'x86-64 code'];
			case 'loader':
				return ebpf ? ['loader', 'your program'] : ['insmod', 'then cat /proc/…'];
			case 'verifier':
				return ebpf ? ['verifier', rejected ? 'rejected ✕' : "proves it's safe"] : ['verifier', "doesn't exist"];
			case 'jit':
				return ebpf ? ['JIT', 'bytecode → x86'] : ['module loader', 'relocate + link'];
			case 'hook':
				return ebpf
					? ['tracepoint', step >= 5 ? 'count_exec attached' : 'sys_enter_execve']
					: ['kprobe', crash ? 'handler crashed' : step >= 5 ? 'handler armed' : '__x64_sys_execve'];
			case 'procs':
				return ['processes', s.lastComm && step === RUN_STEP ? `execve("${s.lastComm}")` : 'calling execve()'];
			case 'map':
				return ebpf ? ['BPF map', `counts · ${entries} keys`] : ['hash table', `module memory · ${entries}`];
		}
	};

	/* ------------------------------------------------------------- tokens */

	interface Token {
		key: string;
		at: Pt;
		label?: string;
		kind?: 'bad' | 'event' | 'read';
	}
	const tokens: Token[] = [];
	const objLabel = mode === 'ebpf' ? 'bytecode' : '.ko';
	if (step === 1) tokens.push({ key: 'c', at: along(PATH.compile, win(p, 0.15, 0.75)) });
	if (step === 2) {
		const pts = p < 0.45 ? along(PATH.ship, win(p, 0, 0.45)) : along(PATH.load, win(p, 0.45, 1));
		tokens.push({ key: 'l', at: pts, label: objLabel });
	}
	if (step === VERIFY_STEP) {
		if (mode === 'lkm') tokens.push({ key: 'v', at: along(PATH.verified, win(p, 0.3, 0.9)), label: 'unchecked' });
		else if (p < VERDICT_AT) tokens.push({ key: 'v', at: [520, 183 + Math.sin(p * 40) * 3] });
		else if (rejects) tokens.push({ key: 'v', at: along(PATH.reject, win(p, VERDICT_AT, 1)), label: VERDICT[prog].errno, kind: 'bad' });
		else tokens.push({ key: 'v', at: along(PATH.verified, win(p, VERDICT_AT, 1)) });
	}
	if (step === 4) tokens.push({ key: 'j', at: [325, 183 + Math.sin(p * 30) * 3] });
	if (step === 5) tokens.push({ key: 'a', at: along(PATH.attach, win(p, 0.1, 0.7)), label: mode === 'ebpf' ? 'bpf_link' : 'kprobe' });

	let hookBusy = false;
	if (step === RUN_STEP) {
		// Once the kernel has crashed, nothing moves any more.
		const t = crash ? crash.t : elapsed.current;
		for (const ev of sim.current.events) {
			const a = t - ev.t0;
			if (a < EV_TO_HOOK) tokens.push({ key: `e${ev.id}`, at: along(PATH.event, ease(a / EV_TO_HOOK)), label: ev.comm, kind: 'event' });
			else if (a < EV_TO_HOOK + EV_IN_HOOK || crash) {
				hookBusy = true;
				if (crash?.comm === ev.comm) tokens.push({ key: `e${ev.id}`, at: [125, 183], kind: 'bad' });
			} else
				tokens.push({
					key: `e${ev.id}`,
					at: along(PATH.record, ease((a - EV_TO_HOOK - EV_IN_HOOK) / EV_TO_MAP)),
					label: '+1',
					kind: 'event',
				});
		}
		for (const r of sim.current.reads) tokens.push({ key: `r${r.t0}`, at: along(PATH.read, ease((t - r.t0) / READ_MS)), kind: 'read' });
	}

	const pathOn = (name: string): boolean => {
		switch (name) {
			case 'compile':
				return step >= 1;
			case 'ship':
			case 'load':
				return step >= 2;
			case 'reject':
				return rejected;
			case 'verified':
				return !rejects && (step > VERIFY_STEP || (step === VERIFY_STEP && (mode === 'lkm' || p >= VERDICT_AT)));
			case 'attach':
				return !rejects && step >= 5;
			default:
				return !rejects && step === RUN_STEP;
		}
	};

	const crashText = crash ? (prog === 'null' ? 'Oops · kernel tainted' : `CPU#3 stuck · soft lockup`) : null;
	const crashShown = crash && (prog === 'null' || elapsed.current - crash.t > LOCKUP_REPORT_MS * 0.4);

	/* ------------------------------------------------------------- render */

	return (
		<figure className="ebpf-demo" ref={rootRef}>
			<div className="eb-controls">
				<Segmented label="program" value={prog} options={PROGS} onChange={(pr) => reset(pr as Prog)} />
			</div>

			<svg
				viewBox={`0 0 ${W} ${H}`}
				className={crash && crashShown ? 'eb-svg eb-crashed' : 'eb-svg'}
				role="img"
				aria-label={`Diagram of loading ${mode === 'ebpf' ? 'an eBPF program' : 'a kernel module'}, step ${step + 1} of 7: ${STEP_LABELS[mode][step]}`}
			>
				<defs>
					<marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
						<path d="M0 0L8 4L0 8z" className="eb-arrowhead" />
					</marker>
				</defs>

				<rect x="0" y={BOUNDARY} width={W} height={H - BOUNDARY} className="eb-kernel-band" rx="6" />
				<text x="12" y="18" className="eb-zone">
					user space · ring 3
				</text>
				<text x="12" y={BOUNDARY + 20} className="eb-zone">
					kernel space · ring 0
				</text>
				<line x1="0" x2={W} y1={BOUNDARY} y2={BOUNDARY} className="eb-boundary" />
				<text x="300" y={BOUNDARY - 6} className="eb-zone eb-small" textAnchor="middle">
					syscall boundary
				</text>

				{Object.entries(PATH).map(([name, pts]) =>
					name === 'reject' && !rejected ? null : (
						<path
							key={name}
							d={pathD(pts)}
							className={`eb-path ${pathOn(name) ? 'on' : ''} ${name === 'reject' ? 'bad' : ''}`}
							markerEnd={`url(#${arrowId})`}
						/>
					),
				)}
				<text x="182" y="52" className="eb-plabel" textAnchor="middle">
					{mode === 'ebpf' ? 'clang' : 'kbuild'}
				</text>
				<text x="449" y="142" className="eb-plabel" textAnchor="end">
					{mode === 'ebpf' ? 'bpf()' : 'finit_module()'}
				</text>
				<text x="571" y="170" className="eb-plabel" transform="rotate(90 571 170)" textAnchor="middle">
					{mode === 'ebpf' ? 'read map' : 'read /proc'}
				</text>

				{(Object.keys(BOX) as BoxName[]).map((name) => {
					const [title, sub] = label(name);
					const b = BOX[name];
					const ghost = mode === 'lkm' && name === 'verifier';
					return (
						<g key={name} className={`eb-box ${boxState(name)} ${ghost ? 'ghost' : ''} ${name === 'hook' && hookBusy && !crash ? 'busy' : ''}`}>
							<rect x={b.x} y={b.y} width={b.w} height={b.h} rx="6" />
							<text x={b.x + 10} y={b.y + 19} className="eb-title">
								{title}
							</text>
							<text x={b.x + 10} y={b.y + 35} className="eb-sub">
								{sub}
							</text>
							{ghost && <line x1={b.x + 8} x2={b.x + b.w - 8} y1={b.y + 15} y2={b.y + 15} className="eb-strike" />}
						</g>
					);
				})}

				{tokens.map((tk) => (
					<g key={tk.key} className={`eb-token ${tk.kind ?? ''}`} transform={`translate(${tk.at[0]} ${tk.at[1]})`}>
						<circle r={tk.kind === 'read' ? 3 : 4.5} />
						{tk.label && (
							<text {...(tk.kind === 'bad' ? { x: 8, y: 3, textAnchor: 'start' } : { y: -9, textAnchor: 'middle' })}>
								{tk.label}
							</text>
						)}
					</g>
				))}

				{crash && crashShown && (
					<text x="296" y="316" className="eb-crash-text" textAnchor="middle">
						{crashText}
					</text>
				)}
			</svg>

			<div className="eb-transport">
				<div className="eb-buttons">
					<button type="button" onClick={() => goto(Math.max(0, step - 1))} disabled={step === 0} aria-label="Previous step">
						←
					</button>
					<button type="button" className="eb-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
						{playing ? '❚❚' : '▶'}
					</button>
					<button type="button" onClick={() => goto(Math.min(lastStep, step + 1))} disabled={step >= lastStep} aria-label="Next step">
						→
					</button>
				</div>
				<ol className="eb-steps">
					{STEP_LABELS[mode].map((l, i) => (
						<li key={l}>
							<button
								type="button"
								disabled={i > lastStep}
								aria-current={i === step ? 'step' : undefined}
								className={i < step ? 'done' : ''}
								onClick={() => goto(i)}
							>
								<span className="eb-num">{i + 1}</span>
								{l}
							</button>
						</li>
					))}
				</ol>
			</div>

			<p className="eb-caption">{caption(mode, prog, step, step === VERIFY_STEP && p >= VERDICT_AT, !!crashShown)}</p>

			<Detail
				mode={mode}
				prog={prog}
				step={step}
				p={p}
				sim={sim.current}
				t={elapsed.current}
				onRun={runCommand}
				onReboot={reboot}
			/>
		</figure>
	);
}

/* ------------------------------------------------------------ subparts */

function Segmented({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: { id: string; label: string }[];
	onChange: (id: string) => void;
}) {
	return (
		<div className="eb-seg" role="radiogroup" aria-label={label}>
			<span className="eb-seg-label">{label}</span>
			<div className="eb-seg-opts">
				{options.map((o) => (
					<button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
						{o.label}
					</button>
				))}
			</div>
		</div>
	);
}

function Code({ lines, upTo = Infinity, numbered = false }: { lines: Line[]; upTo?: number; numbered?: boolean }) {
	return (
		<pre className="eb-code">
			{lines.map((l, i) => (
				<div key={i} className={`${l.bad ? 'bad' : ''} ${i < upTo ? '' : 'hidden'}`}>
					{numbered && <span className="eb-ln">{i}:</span>}
					{l.text || ' '}
				</div>
			))}
		</pre>
	);
}

interface DetailProps {
	mode: Mode;
	prog: Prog;
	step: number;
	p: number;
	sim: Sim;
	t: number;
	onRun: () => void;
	onReboot: () => void;
}

function Detail({ mode, prog, step, p, sim, t, onRun, onReboot }: DetailProps) {
	const reveal = (n: number, from = 0.1, to = 0.8) => Math.ceil(clamp01((p - from) / (to - from)) * n);
	const ebpf = mode === 'ebpf';

	let title = '';
	let body: ReactNode = null;

	switch (step) {
		case 0:
			title = ebpf ? 'count.bpf.c' : 'counter.c';
			body = <Code lines={source(mode, prog)} />;
			break;
		case 1: {
			if (ebpf) {
				title = 'llvm-objdump -d count.bpf.o';
				const bc = BYTECODE[prog].map((text) => ({ text }));
				body = <Code lines={bc} upTo={reveal(bc.length)} numbered />;
			} else {
				title = 'objdump -d counter.ko';
				body = <Code lines={OBJDUMP[prog]} upTo={reveal(OBJDUMP[prog].length)} />;
			}
			break;
		}
		case 2:
			title = 'strace';
			body = ebpf ? (
				<Code
					lines={[
						'bpf(BPF_PROG_LOAD, {',
						'    prog_type = BPF_PROG_TYPE_TRACEPOINT,',
						`    insn_cnt  = ${BYTECODE[prog].length},`,
						'    license   = "GPL",',
						'    log_level = 1,',
						'}, 148)',
					].map((text) => ({ text }))}
					upTo={reveal(6, 0, 0.5)}
				/>
			) : (
				<Code
					lines={['$ sudo insmod counter.ko', 'finit_module(3, "", 0)', '# the whole module is now in kernel memory'].map((text) => ({ text }))}
					upTo={reveal(3, 0, 0.6)}
				/>
			);
			break;
		case 3:
			if (ebpf) {
				title = 'verifier log';
				body = <VerifierLog prog={prog} p={p} />;
			} else {
				title = 'what load_module() checks';
				const n = reveal(LKM_CHECKS.length, 0.05, 0.8);
				body = (
					<ul className="eb-checks">
						{LKM_CHECKS.map((c, i) => (
							<li key={i} className={`${i < n ? '' : 'hidden'} ${c.mark === '✕' ? 'bad' : ''}`}>
								<span className="eb-mark">{c.mark}</span>
								{c.text}
							</li>
						))}
					</ul>
				);
			}
			break;
		case 4:
			if (ebpf) {
				title = 'JIT: BPF registers map onto x86 registers';
				const n = reveal(JIT.length, 0.05, 0.75);
				body = (
					<div className="eb-jit">
						{JIT.map(([a, b], i) => (
							<div key={i} className={i < n ? '' : 'hidden'}>
								<code>{a}</code>
								<span className="eb-arrowtxt">→</span>
								<code>{b}</code>
							</div>
						))}
					</div>
				);
			} else {
				title = 'dmesg (debug)';
				body = <Code lines={RELOCS.map((text) => ({ text }))} upTo={reveal(RELOCS.length, 0.05, 0.8)} />;
			}
			break;
		case 5:
			title = ebpf ? 'loader' : 'counter_init()';
			body = ebpf ? (
				<Code
					lines={['link = bpf(BPF_LINK_CREATE, {', '    prog_fd = 4,', '    target  = tracepoint/syscalls/sys_enter_execve,', '})'].map((text) => ({
						text,
					}))}
					upTo={reveal(4, 0, 0.6)}
				/>
			) : (
				<Code
					lines={['ret = register_kprobe(&kp);', '/* breakpoint patched into __x64_sys_execve */', '/* ret = 0 */'].map((text) => ({ text }))}
					upTo={reveal(3, 0, 0.6)}
				/>
			);
			break;
		default: {
			if (sim.crash) {
				title = 'dmesg';
				const logs = DMESG[prog as 'null' | 'loop'](sim.crash.comm, sim.crash.pid);
				const delay = prog === 'loop' ? LOCKUP_REPORT_MS : 0;
				const n = Math.ceil(clamp01((t - sim.crash.t - delay) / 1800) * logs.length);
				body = (
					<>
						<Code lines={logs.map((text, i) => ({ text, bad: i === 0 }))} upTo={n} />
						<button type="button" className="eb-action" onClick={onReboot}>
							reboot
						</button>
					</>
				);
				break;
			}
			title = ebpf ? 'what the loader sees in the map' : '$ cat /proc/counter';
			const all = Object.entries(sim.seen).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
			const rows = all.slice(0, 5);
			body = (
				<>
					<table className="eb-table">
						<thead>
							<tr>
								<th>comm</th>
								<th>execs</th>
							</tr>
						</thead>
						<tbody>
							{rows.length ? (
								rows.map(([k, v]) => (
									<tr key={k}>
										<td>{k}</td>
										<td>{v}</td>
									</tr>
								))
							) : (
								<tr>
									<td colSpan={2} className="muted">
										waiting for the first read…
									</td>
								</tr>
							)}
							{all.length > rows.length && (
								<tr>
									<td colSpan={2} className="muted">
										+{all.length - rows.length} more
									</td>
								</tr>
							)}
						</tbody>
					</table>
					<button type="button" className="eb-action" onClick={onRun}>
						run a command
					</button>
				</>
			);
		}
	}

	return (
		<div className="eb-detail">
			<div className="eb-detail-title">{title}</div>
			{body}
		</div>
	);
}

function VerifierLog({ prog, p }: { prog: Prog; p: number }) {
	const trace = TRACE[prog];
	const bc = BYTECODE[prog];
	// Walk the trace over the first part of the step, then show the verdict.
	const k = Math.min(trace.length, Math.floor((p / VERDICT_AT) * trace.length) + 1);
	const current = p < VERDICT_AT ? trace[k - 1] : null;
	const notes = new Map<number, { note: string; err?: boolean }>();
	for (const e of trace.slice(0, k)) notes.set(e.pcs[e.pcs.length - 1], e);
	const verdict = VERDICT[prog];
	const done = p >= VERDICT_AT;
	return (
		<>
			<pre className="eb-code eb-verifier">
				{bc.map((text, pc) => {
					const n = notes.get(pc);
					const cls = [
						current?.pcs.includes(pc) ? 'cursor' : '',
						done && pc === BAD_PC[prog] ? 'bad' : '',
						n?.err ? 'bad' : '',
					].join(' ');
					return (
						<div key={pc} className={cls}>
							<span className="eb-ln">{pc}:</span>
							<span className="eb-insn">{text}</span>
							{n && <span className="eb-note">; {n.note}</span>}
						</div>
					);
				})}
			</pre>
			<div className={`eb-verdict ${done ? '' : 'hidden'} ${verdict.err ? 'bad' : 'good'}`}>
				{verdict.err ? '✕ ' : '✓ '}
				{verdict.text}
			</div>
		</>
	);
}
