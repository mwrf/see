const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const port = process.env.PORT || 3001;

// Log environment variables for OAuth and session
console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Loaded' : 'Not Loaded');
console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'Loaded' : 'Not Loaded');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? 'Loaded' : 'Not Loaded');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set, defaulting to /');


app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Allow requests from frontend
  credentials: true // Allow session cookies to be sent
}));
app.use(express.json());

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'your default secret key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Initialize Passport and session
app.use(passport.initialize());
app.use(passport.session());

// Passport Google OAuth 2.0 Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  function(accessToken, refreshToken, profile, done) {
    console.log('Google auth profile:', profile);
    return done(null, profile);
  }
));

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});

// --- Authentication Routes ---
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login-failed' }),
  function(req, res) {
    // Successful authentication, redirect to frontend home or a dashboard.
    console.log('Authentication successful, redirecting. FRONTEND_URL should be the Next.js app URL.');
    res.redirect(process.env.FRONTEND_URL || '/');
  }
);

app.get('/auth/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.json({ message: 'Logged out successfully' });
  });
});

app.get('/auth/current-user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json(req.user);
  } else {
    res.status(401).json({ message: 'Not authenticated' });
  }
});

app.get('/login-failed', (req, res) => {
  res.status(401).send('Login failed. Please try again.');
});

// --- Middleware for protected routes ---
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Authentication required' });
}

// --- End Authentication Routes & Middleware ---


let mappings = {};

function loadMappings() {
  try {
    const mappingsPath = path.join(__dirname, 'mappings.json');
    const data = fs.readFileSync(mappingsPath, 'utf8');
    mappings = JSON.parse(data);
    console.log('Mappings loaded successfully.');
  } catch (err) {
    console.error('Error loading mappings.json:', err);
    mappings = {};
  }
}

loadMappings();
setInterval(loadMappings, 5000);

// API endpoint to get all mappings (unprotected)
app.get('/api/mappings', (req, res) => {
  res.json(mappings);
});

// API endpoint to update mappings (protected)
app.post('/api/mappings', ensureAuthenticated, (req, res) => {
  // Logic to update mappings will go here later
  // For now, just acknowledge
  console.log('Protected /api/mappings POST endpoint reached by user:', req.user ? req.user.displayName : 'Unknown');
  res.json({ message: 'Mappings update endpoint reached (protected)' });
});


// Redirection logic (should be one of the last routes)
app.use((req, res, next) => {
  // Exclude /api/ and /auth/ paths from general short URL redirection
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return next(); // Pass to actual API/auth routes or 404 if not defined
  }

  const redirectUrl = mappings[req.path];
  if (redirectUrl) {
    console.log(`Redirecting ${req.path} to ${redirectUrl}`);
    res.redirect(302, redirectUrl);
  } else {
    res.status(404).send(`
      <html>
        <body>
          <h1>Short URL Not Found</h1>
          <p>The path <b>${req.path}</b> does not have a configured short URL.</p>
          <p><a href="/api/mappings">View available mappings (JSON)</a></p>
        </body>
      </html>
    `);
  }
});

app.listen(port, () => {
  console.log(`Express server listening at http://localhost:${port}`);
});
