import bcrypt from 'bcryptjs';
import jwksClient from 'jwks-rsa';
import sgMail from '@sendgrid/mail';
import { OAuth2Client } from 'google-auth-library';
import { Firestore } from '@google-cloud/firestore';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;

const msIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const msClient = jwksClient({
  jwksUri: `${msIssuer}/discovery/v2.0/keys`,
});
const getKey = (header, callback) => {
  msClient.getSigningKey(header.kid, (err, key) => {
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  })
}

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const firestore = new Firestore();

const login = async (req, reply) => {
  const { email, password } = req.body;

  const userDoc = await firestore.collection('users')
    .where('email', '==', email)
    .limit(1)
    .get();
  if (userDoc.empty) return reply.code(401).send({ error: 'Invalid email or password' });

  const user = userDoc.docs[0].data();
  const userId = userDoc.docs[0].id;
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return reply.code(401).send({ error: 'Invalid email or password' });

  const { accessToken, refreshToken } = req.server.generateTokens({ ...user });

  // Persist refresh token (could be array for multi-device support)
  await firestore.collection('users').doc(userId).update({
    refreshTokens: [...(user.refreshTokens || []), refreshToken],
  });

  return { id: userId, ...user, accessToken, refreshToken };
}

const signUp = async (req, reply) => {
  const { email, password, confirmPassword, companyName, fullName } = req.body;

  if (password !== confirmPassword) {
    return reply.code(400).send({ error: 'Passwords do not match' });
  }

  if (password.length < 6) {
    return reply.code(400).send({ error: 'Password must be at least 6 characters long'})
  }

  if (!companyName || !email || !fullName) {
    return reply.code(400).send({ error: 'Missing required fields'})
  }

  const userDoc = await firestore.collection('users')
    .where('email', '==', email)
    .limit(1)
    .get();
  
  if (!userDoc.empty) {
    return reply.code(400).send({ error: 'Email already in use'})
  }

  if (userDoc.empty) {
    // get role from roles collection
    const roleDoc = await firestore.collection('roles')
      .where('name', '==', 'Client')
      .limit(1)
      .get();
    if (roleDoc.empty) {
      return reply.code(500).send({ error: 'Default role not found'})
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      email,
      password: hashedPassword,
      companyName,
      fullName,
      role: roleDoc.docs[0].data(),
      createdAt: new Date().toISOString(),
      refreshTokens: [],
    }

    await firestore.collection('users').add(newUser);

    return { ok: true, message: 'User created successfully' };
  }
}

const refreshTokens = (app) => async (req, reply) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return reply.code(400).send({ error: 'Refresh token is required'});

  try {
    const decoded = app.jwt.verify(refreshToken);
    const userDoc = await firestore.collection('users')
      .where('email', '==', decoded.email)
      .limit(1)
      .get();
    if (userDoc.empty) return reply.code(401).send({ error: 'Invalid refresh token'})

    const user = userDoc.docs[0].data();
    const userId = userDoc.docs[0].id;
    if (!user.refreshTokens?.includes(refreshToken)) {
      return reply.code(401).send({ error: 'Refresh token revoked' });
    }

    const { accessToken, refreshToken: newRefreshToken } = app.generateTokens({ ...user});

    await firestore.collection('users').doc(userDoc.docs[0].id).update({
      refreshTokens: [
        ...user.refreshTokens.filter(t => t !== refreshToken),
        newRefreshToken,
      ]
    })

    return { id: userId, ...user, accessToken, refreshToken: newRefreshToken };
  } catch (err) {
    console.log(err.message);
    return reply.code(401).send({ error: 'Invalid refresh token' });
  }
}

const logout = (app) => async (req, reply) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return reply.code(400).send({ error: 'Refresh token is required' });

  try {
    const decoded = app.jwt.verify(refreshToken);
    const userDoc = await firestore.collection('users')
      .where('email', '==', decoded.email)
      .limit(1)
      .get();
    if (userDoc.empty) return reply.code(401).send({ error: 'Invalid refresh token' });

    const user = userDoc.docs[0].data();
    if (!user.refreshTokens?.includes(refreshToken)) {
      return reply.code(401).send({ error: 'Refresh token already revoked' });
    }

    await firestore.collection('users').doc(userDoc.docs[0].id).update({
      refreshTokens: user.refreshTokens.filter(t => t !== refreshToken)
    })

    return { ok: true, message: 'Logged out successfully' };
  } catch (err) {
    console.log(err.message);
    return reply.code(401).send({ error: 'Invalid refresh token'});
  }
}

const googleAuth = async (req, reply) => {
  const { idToken } = req.body;
  if (!idToken) return reply.code(400).send({ error: 'ID token is required' });

  // Verify the ID token with Google
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  const { sub: googleId, email, name, picture } = payload;

  const userDoc = await firestore.collection('users')
    .where('email', '==', email)
    .limit(1)
    .get();
  
  if (userDoc.empty) {
    // New user, create account
    const roleDoc = await firestore.collection('roles')
      .where('name', '==', 'Client')
      .limit(1)
      .get();
    if (roleDoc.empty) {
      return reply.code(500).send({ error: 'Default role not found' });
    }

    const { accessToken, refreshToken } = req.server.generateTokens({ ...newUser });

    const newUser = {
      email,
      fullName: name,
      avatar: picture,
      googleId,
      role: roleDoc.docs[0].data(),
      createdAt: new Date().toISOString(),
      refreshTokens: [refreshToken],
    }
    const newUserDoc = await firestore.collection('users').add(newUser);

    return { id: newUserDoc.id, ...newUser, accessToken, refreshToken };
  } else {
    // Existing user, log in
    const user = userDoc.docs[0].data();
    const userId = userDoc.docs[0].id;
    if (user.googleId !== googleId) {
      return reply.code(400).send({ error: 'Google ID does not match' });
    }

    const { accessToken, refreshToken } = req.server.generateTokens({ ...user });

    await firestore.collection('users').doc(userId).update({
      refreshTokens: [...(user.refreshTokens || []), refreshToken],
    });

    return { id: userId, ...user, accessToken, refreshToken };
  }
}

const microsoftAuth = async (req, reply) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return reply.code(400).send({ error: 'ID token is required' });

    // Verify the ID token with Microsoft
    const decoded = await new Promise((resolve, reject) => {
      req.server.jwt.verify(idToken, { issuer: msIssuer, audience: microsoftClientId }, getKey, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      })
    });

    const { oid: microsoftId, email, name } = decoded;

    const userDoc = await firestore.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();
    if (userDoc.empty) {
      // New user, create account
      const roleDoc = await firestore.collection('roles')
        .where('name', '==', 'Client')
        .limit(1)
        .get();
      if (roleDoc.empty) {
        return reply.code(500).send({ error: 'Default role not found' });
      }

      const newUser = {
        email,
        fullName: name,
        microsoftId,
        role: roleDoc.docs[0].data(),
        createdAt: new Date().toISOString(),
        refreshTokens: [],
      }

      const { accessToken, refreshToken } = req.server.generateTokens({ ...newUser });
      newUser.refreshTokens.push(refreshToken);

      const newUserDoc = await firestore.collection('users').add(newUser);

      return { id: newUserDoc.id, ...newUser, accessToken, refreshToken };
    } else {
      // Existing user, log in
      const user = userDoc.docs[0].data();
      const userId = userDoc.docs[0].id;
      if (user.microsoftId !== microsoftId) {
        return reply.code(400).send({ error: 'Microsoft ID does not match' });
      }

      const { accessToken, refreshToken } = req.server.generateTokens({ ...user });

      await firestore.collection('users').doc(userId).update({
        refreshTokens: [...(user.refreshTokens || []), refreshToken],
      });

      return { id: userId, ...user, accessToken, refreshToken };
    }
  } catch (err) {
    console.log(err.message);
    return reply.code(401).send({ error: 'Invalid token' });
  }
}

const forgotPassword = async (req, reply) => {
  const { email } = req.body;
  if (!email) return reply.code(400).send({ error: 'Email is required' });

  const snapshot = await firestore.collection('users')
    .where('email', '==', email)
    .limit(1)
    .get();
  
  if (snapshot.empty) {
    return reply.code(400).send({ error: 'Email not found' });
  }

  const userDoc = snapshot.docs[0];
  const user = userDoc.data();

  // generate a reset token valid for 1 hour
  const token = req.server.jwt.sign(
    { email: user.email },
    { exporesIn: '1h' }
  )

  // store token in user document
  await firestore.collection('password_resets').doc(userDoc.id).set({
    token,
    createdAt: new Date().toISOString(),
    used: false,
  });

  // send email with reset link
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  const msg = {
    to: user.email,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: 'Password Reset Request',
    text: 'Click here to reset your password: ' + resetLink,
    html: `<p>Click >a href="${resetLink}">here</p> to reset your password.`,
  }

  await sgMail.send(msg);

  return reply.code(200).send({ ok: true, message: 'Password reset email sent' });
}

const resetPassword = async (req, reply) => {
  const { token, newPassword, confirmNewPassword } = req.body;
  if (!token || !newPassword || !confirmNewPassword) {
    return reply.code(400).send({ error: 'All fields are required' });
  }

  if (newPassword !== confirmNewPassword) {
    return reply.code(400).send({ error: 'Passwords do not match' });
  }

  if (newPassword.length < 6) {
    return reply.code(400).send({ error: 'Password must be at least 6 characters long' });
  }

  try {
    const decoded = req.server.jwt.verify(token);
    const { email } = decoded;

    const snapshot = await firestore.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return reply.code(400).send({ error: 'Invalid token' });
    }

    const userDoc = snapshot.docs[0];
    const resetDoc = await firestore.collection('password_resets').doc(userDoc.id).get();
    if (!resetDoc.exists) {
      return reply.code(400).send({ error: 'Invalid token' });
    }

    const resetData = resetDoc.data();
    if (resetData.used) {
      return reply.code(400).send({ error: 'Yoken already used' });
    }

    // update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await firestore.collection('users').doc(userDoc.id).update({
      password: hashedPassword,
    })

    // mark token as used
    await firestore.collection('password_resets').doc(userDoc.id).update({
      used: true,
    })

    return reply.code(200).send({ ok: true, message: 'Password reset successfully' });
  } catch (err) {
    console.log(err.message);
    return reply.code(400).send({ error: 'Invalid or expired token' });
  }
}

export { login, signUp, refreshTokens, logout, googleAuth, microsoftAuth, forgotPassword, resetPassword };