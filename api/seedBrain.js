import { db } from './firestore.js';
import brainData from '../vsuite_brain.json';

async function seedBrain() {
	console.log('Seeding vSuite Brain data...');

	if (brainData.personas) {
		for (const [id, persona] of Object.entries(brainData.personas)) {
			await db.collection('personas').doc(id).set(persona);
		}
	}
	if (brainData.prompts) {
		for (const [id, prompt] of Object.entries(brainData.prompts)) {
			await db.collection('prompts').doc(id).set(prompt);
		}
	}
	if (brainData.subPrompts) {
		for (const [id, subPrompt] of Object.entries(brainData.subPrompts)) {
			await db.collection('subPrompts').doc(id).set(subPrompt);
		}
	}
	if (brainData.outputInstructions) {
		for (const [id, output] of Object.entries(brainData.outputInstructions)) {
			await db.collection('outputInstructions').doc(id).set(output);
		}
	}

	console.log('Brain data seeding complete.');
}
seedBrain().catch(console.error);
