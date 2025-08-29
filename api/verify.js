import { db } from './firestore.js';

async function allDocs(col) {
	const snap = await db.collection(col).get();
	return new Map(snap.docs.map(d => [d.id, d.data()]));
}

async function main() {
	const [kpis, personas, prompts, subs, outputs] = await Promise.all([
		allDocs('kpis'),
		allDocs('personas'),
		allDocs('prompts'),
		allDocs('subPrompts'),
		allDocs('outputInstructions')
	]);

	console.table([
		{ col: 'kpis', count: kpis.size },
		{ col: 'personas', count: personas.size },
		{ col: 'prompts', count: prompts.size },
		{ col: 'subPrompts', count: subs.size },
		{ col: 'outputInstructions', count: outputs.size }
	]);

	const badPersonaRefs = [];
	for (const [id, p] of prompts) {
		if (p.personaRef && !personas.has(p.personaRef)) badPersonaRefs.push({ prompt: id, personaRef: p.personaRef });
	}

	const badPromptRefs = [];
	for (const [id, s] of subs) {
		if (s.promptRef && !prompts.has(s.promptRef)) badPromptRefs.push({ subPrompt: id, promptRef: s.promptRef });
	}

	const badOutputRefs = [];
	for (const [id, o] of outputs) {
		if (o.contextRef && !(prompts.has(o.contextRef) || personas.has(o.contextRef))) {
			badOutputRefs.push({ output: id, contextRef: o.contextRef });
		}
	}

	if (badPersonaRefs.length) { console.warn('\n⚠️ Missing personaRef targets in prompts:'); console.table(badPersonaRefs); }
	if (badPromptRefs.length) { console.warn('\n⚠️ Missing promptRef targets in subPrompts:'); console.table(badPromptRefs); }
	if (badOutputRefs.length) { console.warn('\n⚠️ Missing contextRef targets in outputInstructions:'); console.table(badOutputRefs); }

	const hasErrors = badPersonaRefs.length || badPromptRefs.length || badOutputRefs.length;
	console.log(`\n✅ Verify complete. Integrity: ${hasErrors ? 'ISSUES FOUND' : 'OK'}`);
	process.exit(hasErrors ? 1 : 0);
}

main().catch(e => { console.error('Verify failed:', e); process.exit(1); });
