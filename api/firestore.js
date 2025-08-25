import { Firestore } from '@google-cloud/firestore';
import dotenv from 'dotenv';
dotenv.config();

export const db = new Firestore();
