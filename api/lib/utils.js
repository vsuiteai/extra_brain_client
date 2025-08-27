

// Utility to generate tokens
export function generateTokens(app, payload) {
  const accessToken = app.jwt.sign(payload, { expiresIn: '1d' });
  const refreshToken = app.jwt.sign(payload, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}