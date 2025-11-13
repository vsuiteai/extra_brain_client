/**
 * Authentication controllers
 *
 * Endpoints:
 * - POST /api/auth/login: Authenticate with email/password, sets HttpOnly cookies and returns tokens.
 * - POST /api/auth/signup: Create a new user account.
 * - POST /api/auth/refresh-token: Exchange refresh token for new access token.
 * - GET  /api/auth/me: Return current authenticated user profile.
 * - GET  /api/auth/google-login: Start Google OAuth (redirect).
 * - GET  /api/auth/google: Google OAuth callback; sets cookies and redirects to frontend.
 * - POST /api/auth/microsoft: Microsoft OAuth login with ID token.
 * - POST /api/auth/forgot-password: Send password reset email.
 * - POST /api/auth/reset-password: Reset password with token.
 */
import bcrypt from 'bcryptjs';
import jwksClient from 'jwks-rsa';
import jwt from "jsonwebtoken";
import sgMail from '@sendgrid/mail';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';

const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;

const msIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const msClient = jwksClient({
  jwksUri: `${msIssuer}/discovery/v2.0/keys`,
});
const getKey = (header, callback) => {
  msClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
};


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

  const userToTokenize = { id: userId, email, fullName: user.fullName, companyId: user.companyId };

  const { accessToken, refreshToken } = req.server.generateTokens(userToTokenize);

  return reply
    .setCookie('access_token', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      domain: '.vsuite.ai',
    })
    .setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      domain: '.vsuite.ai',
    })
    .code(200)
    .send({ id: userId, ...user, accessToken, refreshToken });
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

  const roleDoc = await firestore.collection('roles')
    .where('name', '==', 'Client')
    .limit(1)
    .get();
  if (roleDoc.empty) {
    return reply.code(500).send({ error: 'Default role not found'})
  }

  const companyRef = await firestore.collection('companies').add({
    CompanyName: companyName,
    createdAt: new Date().toISOString()
  });

  await firestore.collection('companies').doc(companyRef.id).update({
    CompanyID: companyRef.id
  });

  const roleData = roleDoc.docs[0].data();
  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    email,
    password: hashedPassword,
    companyName,
    companyId: companyRef.id,
    fullName,
    roleName: roleData.name,
    role: roleData,
    createdAt: new Date().toISOString(),
  }

  const newUserDoc = await firestore.collection('users').add(newUser);

  const userToTokenize = { id: newUserDoc.id, email, fullName, companyId: companyRef.id };
  const { accessToken, refreshToken } = req.server.generateTokens(userToTokenize);

  return { ok: true, message: 'User created successfully', accessToken, refreshToken };
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

    const userToTokenize = { id: userId, email: user.email, fullName: user.fullName, companyId: user.companyId };

    const { accessToken, refreshToken: newRefreshToken } = app.generateTokens(userToTokenize);

    return { ...userToTokenize, accessToken, refreshToken: newRefreshToken };
  } catch (err) {
    console.log(err.message);
    return reply.code(401).send({ error: 'Invalid refresh token' });
  }
}

const googleLogin = async (req, reply) => {
  const state = req.query.state || '';
  const redirectUrl = `${process.env.BASE_URL}/api/auth/google`;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/auth/oauthchooseaccount?approval_prompt=force&scope=email%20profile%20openid&client_id=${clientId}&redirect_uri=${redirectUrl}&response_type=code&access_type=offline&flowName=GeneralOAuthFlow&state=${state}`;

  return reply.redirect(googleAuthUrl, 302);
}

const googleAuth = async (req, reply) => {
  const { code, state } = req.query;
  if (!code) return reply.code(400).send({ error: 'code is required' });

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLEREDIRECTURI_PATH = '/api/auth/google';

  if (!googleClientId && !googleClientSecret) return reply.code(400).send({ error: 'Google client id and secret are required' });

  const redirectUri = `${process.env.BASE_URL}${GOOGLEREDIRECTURI_PATH}`;

  const oauth2Client = new OAuth2Client(
    googleClientId,
    googleClientSecret,
    redirectUri
  );
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const accessToken = tokens.access_token;
  // const idToken = tokenRes.data.id_token;

  const userInfoUrl = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
  let userInfoRes;
  try {
    userInfoRes = await axios.get(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      timeout: 10000,
    });

    if (userInfoRes.status !== 200 || !userInfoRes.data) {
      return reply.code(500).send({ error: 'Failed to fetch google user info' });
    }
  } catch (err) {
    console.log(err.message);
    return reply.code(500).send({ error: 'Failed to fetch google user info '+ err.message });
  }

  const googleUser = userInfoRes.data;
  const email = googleUser.email;
  const name = googleUser.name || '';
  const picture = googleUser.picture || '';

  if (!email) {
    return reply.code(500).send({ error: 'google account has no email' });
  }

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
    const roleData = roleDoc.docs[0].data();
    const newUser = {
      email,
      fullName: name,
      avatar: picture,
      roleName: roleData.name,
      role: roleData,
      createdAt: new Date().toISOString(),
    }
    const newUserDoc = await firestore.collection('users').add(newUser);

    const userToTokenize = { id: newUserDoc.id, email, fullName: name, companyId: newUser.companyId };

    const { accessToken, refreshToken } = req.server.generateTokens(userToTokenize);

     // 🔐 Set HttpOnly cookies
    reply
    .setCookie('access_token', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      domain: '.vsuite.ai',
    })
    .setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      domain: '.vsuite.ai',
    })

    const redirectTo = `${process.env.FRONTEND_URL}/dashboard/${state ? encodeURIComponent(state) : ''}?response=google_success&id=${newUserDoc.id}`;
    
    return reply.redirect(redirectTo, 302);
  } else {
    // Existing user, log in
    const user = userDoc.docs[0].data();
    const userId = userDoc.docs[0].id;

    const userToTokenize = { id: userId, email, fullName: user.fullName, companyId: user.companyId };

    const { accessToken, refreshToken } = req.server.generateTokens({ ...userToTokenize });

    // 🔐 Set HttpOnly cookies
    reply
    .setCookie('access_token', accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      domain: '.vsuite.ai',
    })
    .setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      domain: '.vsuite.ai',
    })

    const redirectTo = `${process.env.FRONTEND_URL}/dashboard/${state ? encodeURIComponent(state) : ''}?response=google_success&id=${userId}`;
    
    return reply.redirect(redirectTo, 302);
  }
}

const microsoftAuth = async (req, reply) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return reply.code(400).send({ error: 'ID token is required' });

    // Verify the ID token with Microsoft
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(idToken, getKey, { issuer: msIssuer, audience: microsoftClientId }, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      })
    });

    const microsoftId = decoded.oid;
    const email = decoded.email || decoded.preferred_username;
    const name = decoded.name || `${decoded.given_name || ''} ${decoded.family_name || ''}`.trim();

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
      const roleData = roleDoc.docs[0].data();
      const newUser = {
        email,
        fullName: name,
        microsoftId,
        roleName: roleData.name,
        role: roleData,
        createdAt: new Date().toISOString(),
      }

      const newUserDoc = await firestore.collection('users').add(newUser);

      const userToTokenize = { id: newUserDoc.id, email, fullName: name, companyId: newUser.companyId };

      const { accessToken, refreshToken } = req.server.generateTokens({ ...userToTokenize });

      return { ...userToTokenize, accessToken, refreshToken };
    } else {
      // Existing user, log in
      const user = userDoc.docs[0].data();
      const userId = userDoc.docs[0].id;
      if (user.microsoftId !== microsoftId) {
        return reply.code(400).send({ error: 'Microsoft ID does not match' });
      }

      const userToTokenize = { id: userId, email, fullName: user.fullName, companyId: user.companyId };

      const { accessToken, refreshToken } = req.server.generateTokens({ ...userToTokenize });

      return { ...userToTokenize, accessToken, refreshToken };
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

  const emailTemplate = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Password Reset</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" style="padding:20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td align="center" bgcolor="#4F46E5" style="padding:20px 30px;">
              <h1 style="margin:0;font-size:24px;color:#ffffff;">Reset Your Password</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:30px;">
              <p style="margin:0 0 15px;font-size:16px;color:#333;">Hello,</p>
              <p style="margin:0 0 15px;font-size:16px;color:#333;">
                We received a request to reset your password. Click the button below to set a new password:
              </p>
              <p style="text-align:center;margin:30px 0;">
                <a href="{{resetLink}}" 
                   style="background-color:#4F46E5;color:#ffffff;text-decoration:none;
                          padding:12px 24px;border-radius:6px;font-size:16px;
                          display:inline-block;">
                  Reset Password
                </a>
              </p>
              <p style="margin:0 0 15px;font-size:14px;color:#666;">
                If you didn’t request this, you can safely ignore this email.
              </p>
              <p style="margin:0;font-size:14px;color:#666;">
                This link will expire in 1 hour for security reasons.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" bgcolor="#f9f9f9" style="padding:20px;font-size:12px;color:#999;">
              <p style="margin:0;">&copy; {{year}} VSuite. All rights reserved.</p>
              <p style="margin:5px 0 0;">If you need help, contact us at 
                <a href="mailto:admin@vsuite.ai style="color:#4F46E5;text-decoration:none;">admin@vsuite.ai</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const msg = {
    to: user.email,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject: 'Password Reset Request',
    text: 'Click here to reset your password: ' + resetLink,
    html: `
    ${emailTemplate
      .replace("{{resetLink}}", resetLink)
      .replace("{{year}}", new Date().getFullYear())}
  `,
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

const me = async (req, reply) => {
  try {
    const decoded = req.user;
    const email = decoded.email;
    if (!email) {
      return reply.code(401).send({ error: 'Invalid token' });
    }
    const userDoc = await firestore.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();
    if (userDoc.empty) {
      return reply.code(404).send({ error: 'User not found' });
    }
    const user = userDoc.docs[0].data();
    const userId = userDoc.docs[0].id;
    // Don't return password
    // eslint-disable-next-line no-unused-vars
    const { password, ...userInfo } = user;
    return { id: userId, ...userInfo, companyId: user.companyId };
  } catch (err) {
    console.log(err.message);
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }
};

const logout = async (req, reply) => {
  try {
    return reply
      .clearCookie('access_token', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: '.vsuite.ai',
        path: '/',
      })
      .clearCookie('refresh_token', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: '.vsuite.ai',
        path: '/',
      })
      .code(200)
      .send({ ok: true });
  } catch (err) {
    console.log(err.message);
    return reply.code(500).send({ error: 'Logout failed' });
  }
};

export {
  login,
  signUp,
  refreshTokens,
  googleAuth,
  microsoftAuth,
  forgotPassword,
  resetPassword,
  googleLogin,
  me,
  logout
};