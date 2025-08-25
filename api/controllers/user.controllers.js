import bcrypt from 'bcryptjs';
import { Firestore } from '@google-cloud/firestore';
import multipart from "@fastify/multipart";
import { Storage } from "@google-cloud/storage";
import path from 'path';

const firestore = new Firestore();
const storage = new Storage();
const bucket = storage.bucket('vsuite-objects');

const updateProfilePicture = (app) => async (req, reply) => {
  app.register(multipart);

  const data = await req.file();
  const { userId } = req.params;

  if (!data) {
    return reply.code(400).send({ error: 'No file uploaded' });
  }

  // genreate a unique filename
  const ext = path.extname(data.filename);
  const gcsFilename = `profile_pictures/${userId}_${Date.now()}${ext}`;
  const file = bucket.file(gcsFilename);

  // Pipe the file to GCS
  await new Promise((resolve, reject) => {
    const stream = file.createWriteStream({
      resumable: false,
      contentType: data.mimetype,
      metadata: {
        contentType: data.mimetype,
      },
    });

    data.file.pipe(stream)
      .on("finish", resolve)
      .on("error", reject);
  })

  // Make the file public
  await file.makePublic;

  // Get the public URL
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFilename}`;

  // Update user profile in Firestore
  await firestore.collection('users').doc(userId).update({
    avatar: publicUrl,
    updatedAt: new Date().toISOString(),
  })

  return reply.code(200).send({ avatar: publicUrl });
}

const getUser = async (req, reply) => {
  const { userId } = req.params;

  const userDoc = await firestore.collection('users').dpc(userId).get();
  if (!userDoc.exists) {
    return reply.code(404).send({ error: 'User not found' });
  }

  return reply.code(200).send({ id: userDoc.id, ...userDoc.data() });
}

const updatePersonalInfo = async (req, reply) => {
  const { userId } = req.params;
  const { firstName, lastName, jobTitle, department, bio } = req.body;

  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    return reply.code(404).send({ error: 'User not found' });
  }

  await firestore.collection('users').doc(userId).update({
    fullName: `${firstName} ${lastName}`,
    jobTitle,
    department,
    bio,
    updatedAt: new Date().toISOString(),
  });

  return reply.code(200).send({ message: 'Profie updated successfully' });
}

const updateContactInfo = async (req, reply) => {
  const { userId } = req.params;
  const { secondaryEmail, phoneNumber } = req.body;

  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    return reply.code(404).send({ error: 'User not found' });
  }

  await firestore.collection('users').doc(userId).update({
    secondaryEmail,
    phoneNumber,
    updatedAt: new Date().toISOString,
  });

  return reply.code(200).send({ message: 'Contact info updated successfully' });
}

const updateEmailNotifPreferences = async (req, reply) => {
  const { userId } = req.params;
  const { emailNotifications } = req.body;

  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    return reply.code(404).send({ error: 'User not found' });
  }

  await firestore.collection('users').doc(userId).update({
    emailNotifications,
    updatedAt: new Date().toISOString(),
  });

  return reply.code(200).send({ message: 'Email notification prefrerences updated successfully' });
}

const updateMoreActivity = async (req, reply) => {
  const { userId } = req.params;
  const { moreActivity } = req.body;

  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    return reply.code(404).send({ error: 'User not found' });
  }

  await firestore.collection('users').doc(userId).update({
    moreActivity,
    updatedAt: new Date().toISOString(),
  });

  return reply.code(200).send({ message: 'More activity preference updated successfully' });
}

const changePassword = async (req, reply) => {
  const { userId } = req.params;
  const { currentPassword, newPassword } = req.body;

  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    return reply.code(404).send({ error: 'User not found' });
  }

  const user = userDoc.data();
  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    return reply.code(400).send({ error: 'Current password is incorrect' });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await firestore.collection('users').doc(userId).update({
    password: hashedPassword,
    updatedAt: new Date().toISOString(),
  });

  return reply.code(200).send({ message: 'Password changed successfully' });
}

export {
  updateProfilePicture,
  getUser,
  updatePersonalInfo,
  updateContactInfo,
  updateEmailNotifPreferences,
  updateMoreActivity,
  changePassword,
};