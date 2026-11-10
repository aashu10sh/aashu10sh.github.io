// Everything the demo shows as text: source, bytecode, verifier traces, kernel logs and captions.
// The listings are simplified for readability, but every message is one the real kernel prints.

export type Mode = 'ebpf' | 'lkm';
export type Prog = 'ok' | 'null' | 'loop';

export interface Line {
	text: string;
	bad?: boolean;
}

export interface TraceEntry {
	pcs: number[];
	note: string;
	err?: boolean;
}

export const PROGS: { id: Prog; label: string }[] = [
	{ id: 'ok', label: 'correct' },
	{ id: 'null', label: 'missing NULL check' },
	{ id: 'loop', label: 'infinite loop' },
];

export const STEP_LABELS: Record<Mode, string[]> = {
	ebpf: ['write', 'compile', 'load', 'verify', 'JIT', 'attach', 'run'],
	lkm: ['write', 'build', 'insmod', 'verify?', 'relocate', 'init', 'run'],
};

/* ---------------------------------------------------------------- source */

const lines = (s: string, badMarker = '//!'): Line[] =>
	s.split('\n').map((text) =>
		text.includes(badMarker) ? { text: text.replace(badMarker, '//'), bad: true } : { text },
	);

const EBPF_HEAD = `// counts: BPF hash map, key = comm, value = u64

SEC("tracepoint/syscalls/sys_enter_execve")
int count_exec(void *ctx)
{
    char comm[16];
    u64 one = 1, *val;

    bpf_get_current_comm(&comm, sizeof(comm));
    val = bpf_map_lookup_elem(&counts, &comm);`;

const EBPF_TAIL: Record<Prog, string> = {
	ok: `    if (val)
        __sync_fetch_and_add(val, 1);
    else
        bpf_map_update_elem(&counts, &comm, &one, BPF_ANY);
    return 0;
}`,
	null: `    *val += 1;            //! val can be NULL
    return 0;
}`,
	loop: `    if (!val)
        return 0;
    while (*val < 100)    //! nothing ever changes *val
        ;
    return 0;
}`,
};

const LKM_HEAD = `// counts: a small hash table, key = comm, value = u64

static int handler(struct kprobe *p, struct pt_regs *regs)
{
    struct entry *e = find(current->comm);`;

const LKM_TAIL: Record<Prog, string> = {
	ok: `    if (e)
        e->count++;
    else
        insert(current->comm);
    return 0;
}`,
	null: `    e->count++;           //! e can be NULL
    return 0;
}`,
	loop: `    if (!e)
        return insert(current->comm);
    while (e->count < 100) //! nothing ever changes it
        ;
    return 0;
}`,
};

const LKM_FOOT = `

static struct kprobe kp = {
    .symbol_name = "__x64_sys_execve",
    .pre_handler = handler,
};`;

export const source = (mode: Mode, prog: Prog): Line[] =>
	mode === 'ebpf'
		? lines(`${EBPF_HEAD}\n${EBPF_TAIL[prog]}`)
		: lines(`${LKM_HEAD}\n${LKM_TAIL[prog]}${LKM_FOOT}`);

/* -------------------------------------------------------------- bytecode */

const PROLOGUE = [
	'r1 = r10',
	'r1 += -16',
	'r2 = 16',
	'call bpf_get_current_comm',
	'r2 = r10',
	'r2 += -16',
	'r1 = map[counts]',
	'call bpf_map_lookup_elem',
];

export const BYTECODE: Record<Prog, string[]> = {
	ok: [
		...PROLOGUE,
		'if r0 == 0 goto +3',
		'r1 = 1',
		'lock *(u64 *)(r0 +0) += r1',
		'goto +2',
		'r1 = map[counts]',
		'call bpf_map_update_elem',
		'r0 = 0',
		'exit',
	],
	null: [...PROLOGUE, 'r1 = 1', 'lock *(u64 *)(r0 +0) += r1', 'r0 = 0', 'exit'],
	loop: [
		...PROLOGUE,
		'if r0 == 0 goto +2',
		'r1 = *(u64 *)(r0 +0)',
		'if r1 < 100 goto -2',
		'r0 = 0',
		'exit',
	],
};

export const BAD_PC: Record<Prog, number | null> = { ok: null, null: 9, loop: 10 };

export const TRACE: Record<Prog, TraceEntry[]> = {
	ok: [
		{ pcs: [0, 1, 2, 3], note: 'R1=fp-16 R2=16: helper writes 16 stack bytes ✓' },
		{ pcs: [4, 5, 6, 7], note: 'R0=map_value_or_null' },
		{ pcs: [8], note: 'branch: walk both sides' },
		{ pcs: [9, 10], note: 'R0≠0 → R0=map_value, 8B write in bounds ✓' },
		{ pcs: [11, 14, 15], note: 'path 1 reaches exit, R0=0 ✓' },
		{ pcs: [12, 13], note: 'R0=0 → never dereferenced ✓' },
		{ pcs: [14, 15], note: 'path 2 reaches exit ✓' },
	],
	null: [
		{ pcs: [0, 1, 2, 3], note: 'R1=fp-16 R2=16: helper writes 16 stack bytes ✓' },
		{ pcs: [4, 5, 6, 7], note: 'R0=map_value_or_null' },
		{ pcs: [8], note: 'R1=1' },
		{ pcs: [9], note: "R0 invalid mem access 'map_value_or_null'", err: true },
	],
	loop: [
		{ pcs: [0, 1, 2, 3], note: 'R1=fp-16 R2=16: helper writes 16 stack bytes ✓' },
		{ pcs: [4, 5, 6, 7], note: 'R0=map_value_or_null' },
		{ pcs: [8], note: 'branch: walk both sides' },
		{ pcs: [9], note: 'R0≠0 → R1=scalar (unknown)' },
		{ pcs: [10], note: 'back-edge to 9, same state as before…' },
		{ pcs: [10], note: 'infinite loop detected at insn 10', err: true },
	],
};

export const VERDICT: Record<Prog, { text: string; err: boolean; errno?: string }> = {
	ok: { text: 'processed 21 insns, 2 paths, all safe → program loaded', err: false },
	null: { text: 'bpf() returns -EACCES: program rejected, never ran', err: true, errno: '-EACCES' },
	loop: { text: 'bpf() returns -EINVAL: program rejected, never ran', err: true, errno: '-EINVAL' },
};

/* ------------------------------------------------------------------- JIT */

export const JIT: [string, string][] = [
	['r1 = r10', 'mov  rdi, rbp'],
	['r1 += -16', 'add  rdi, -16'],
	['r2 = 16', 'mov  esi, 16'],
	['call bpf_get_current_comm', 'call 0xffffffff8a31c4e0'],
	['…', '…'],
	['if r0 == 0 goto +3', 'test rax, rax\nje   .L12'],
	['lock *(u64 *)(r0 +0) += r1', 'lock add qword [rax], rdi'],
	['exit', 'leave\nret'],
];

/* ------------------------------------------------------------ LKM build */

export const OBJDUMP: Record<Prog, Line[]> = {
	ok: lines(`<handler>:
  endbr64
  mov   rdi, gs:current_task
  add   rdi, 0x7a8         ; ->comm
  call  find
  test  rax, rax
  je    .Linsert
  add   qword [rax+0x10], 1
  xor   eax, eax
  ret`),
	null: lines(`<handler>:
  endbr64
  mov   rdi, gs:current_task
  add   rdi, 0x7a8         ; ->comm
  call  find
  add   qword [rax+0x10], 1 ;! rax may be 0
  xor   eax, eax
  ret`, ';!'),
	loop: lines(`<handler>:
  endbr64
  mov   rdi, gs:current_task
  add   rdi, 0x7a8         ; ->comm
  call  find
  test  rax, rax
  je    .Linsert
.Lspin:
  cmp   qword [rax+0x10], 99
  jbe   .Lspin             ;! forever
  xor   eax, eax
  ret`, ';!'),
};

export const LKM_CHECKS: { mark: string; text: string }[] = [
	{ mark: '✓', text: 'ELF headers and sections parse' },
	{ mark: '✓', text: 'vermagic "7.2.15 SMP preempt mod_unload" matches' },
	{ mark: '~', text: 'signature, only if module.sig_enforce=1: proves who built it, not what it does' },
	{ mark: '✕', text: 'pointers, loops, memory access: nobody looks' },
];

export const RELOCS = [
	'apply_relocate_add: counter.ko',
	'  R_X86_64_PLT32 register_kprobe → ffffffff8b2a1c40',
	'  R_X86_64_PLT32 __kmalloc       → ffffffff8b4f02e0',
	'  R_X86_64_32S   .data (kp)      → ffffffffc0a8e000',
	'do_init_module: calling counter_init()',
];

/* --------------------------------------------------------- crash logs */

export const DMESG: Record<'null' | 'loop', (comm: string, pid: number) => string[]> = {
	null: (comm, pid) => [
		'BUG: kernel NULL pointer dereference, address: 0000000000000010',
		'#PF: supervisor write access in kernel mode',
		'Oops: 0002 [#1] PREEMPT SMP NOPTI',
		`CPU: 3 PID: ${pid} Comm: ${comm} Tainted: G           O       7.2.15`,
		'RIP: 0010:handler+0x1d/0x40 [counter]',
		'Call Trace:',
		' kprobe_ftrace_handler+0x10f/0x1b0',
		' __x64_sys_execve+0x5/0x50',
	],
	loop: (comm, pid) => [
		`watchdog: BUG: soft lockup - CPU#3 stuck for 26s! [${comm}:${pid}]`,
		'Modules linked in: counter(O) nf_tables ...',
		`CPU: 3 PID: ${pid} Comm: ${comm} Tainted: G           O L     7.2.15`,
		'RIP: 0010:handler+0x22/0x40 [counter]',
		'Call Trace:',
		' kprobe_ftrace_handler+0x10f/0x1b0',
		' __x64_sys_execve+0x5/0x50',
	],
};

/* -------------------------------------------------------------- captions */

const WRITE_VARIANT: Record<Prog, string> = {
	ok: '',
	null: ' This version forgets to check whether the lookup found anything.',
	loop: ' This version waits for a counter to reach 100, which never happens.',
};

export function caption(mode: Mode, prog: Prog, step: number, verdict: boolean, crashed: boolean): string {
	if (mode === 'ebpf') {
		switch (step) {
			case 0:
				return `The kernel half is written in restricted C: no unbounded loops, no arbitrary pointers, only the helpers the kernel offers. This one counts execve() calls per command name.${WRITE_VARIANT[prog]}`;
			case 1:
				return 'clang -target bpf turns it into BPF bytecode, instructions for a tiny 64-bit virtual machine with 11 registers, packed into an ELF object.';
			case 2:
				return 'The user-space loader hands the bytecode to the kernel with the bpf() syscall. Nothing runs yet.';
			case 3:
				if (!verdict) return 'The verifier simulates every path through the program, tracking what each register could hold…';
				if (prog === 'null')
					return 'The lookup can return NULL and the program writes through it anyway. The verifier refuses, bpf() fails, and not a single instruction ever ran. Your kernel is fine.';
				if (prog === 'loop')
					return 'The verifier comes back to the same instruction in the same state, so the loop can never finish. Rejected before it ever runs. Your kernel is fine.';
				return 'Every path checks out. Both sides of the NULL check are safe, so the program is accepted.';
			case 4:
				return 'Verified bytecode is compiled to native machine code, so it runs about as fast as code built into the kernel.';
			case 5:
				return 'The loader attaches the program to the sys_enter_execve tracepoint. From now on it runs on every execve(), on every CPU.';
			default:
				return 'Every new command fires the hook, the program bumps a counter in the map, and the loader reads the map from user space. Try running a few commands.';
		}
	}
	switch (step) {
		case 0:
			return `A kernel module is plain C linked against kernel internals. Here, a kprobe handler that counts execve() calls per command name.${WRITE_VARIANT[prog]}`;
		case 1:
			return 'Kbuild compiles it straight to x86-64 machine code inside counter.ko. No bytecode, nothing in between that could inspect it.';
		case 2:
			return 'insmod copies the whole .ko into kernel memory with the finit_module() syscall.';
		case 3:
			return `There is no verifier. The kernel checks the ELF format, that it was built for this kernel, and maybe a signature. A signature says who built the module, not whether it is correct.${prog === 'ok' ? '' : ' The bug sails straight through.'}`;
		case 4:
			return "The module loader patches in the addresses of kernel functions and calls counter_init(). The module's code is now part of the kernel, with all of its privileges.";
		case 5:
			return 'counter_init() registers a kprobe on __x64_sys_execve, so the handler runs on every execve().';
		default:
			if (prog === 'null')
				return crashed
					? 'The first lookup comes back NULL and the handler writes through it. The kernel oopses inside some unrelated process and is now tainted. Anything that handler held is never released.'
					: 'Waiting for the first execve()…';
			if (prog === 'loop')
				return crashed
					? 'The first execve() enters the loop and never leaves. That CPU stops scheduling anything else, and the watchdog eventually reports a soft lockup (compressed from ~20s here).'
					: 'Waiting for the first execve()…';
			return 'It works, just like the eBPF version. The difference is that nothing checked that it would.';
	}
}
