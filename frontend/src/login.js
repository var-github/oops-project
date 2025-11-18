import React, { useState, useEffect, useRef } from 'react';
import PhoneInput from 'react-phone-number-input';
// Note: We are strictly overriding styles below.
// import 'react-phone-number-input/style.css';
import { useNavigate } from 'react-router-dom';

// 2. Firebase Imports
import { initializeApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import {
  getDatabase,
  ref,
  set,
  get,
  child,
  runTransaction // Required for the atomic counter logic
} from 'firebase/database';

// 3. Firebase Configuration
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
    databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Global settings
const OTP_QUOTA_LIMIT = 5;

// List of test numbers whose OTP requests will not be counted
const testNumbers = [
    '+919999999999', '+918888888888', '+917777777777',
    '+916666666666', '+915555555555', '+914444444444',
    '+913333333333', '+912222222222', '+911111111111'
];

function Login() {
  const navigate = useNavigate();

  // --- State Variables ---
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);

  // UI Flow Control States
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [showProfileSetup, setShowProfileSetup] = useState(false);

  // Profile Setup States
  const [userName, setUserName] = useState('');
  const [userType, setUserType] = useState('consumer');

  // Feedback States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const recaptchaRef = useRef(null);

  // 1. Setup reCAPTCHA Verifier
  useEffect(() => {
    if (!auth || recaptchaRef.current) return;

    try {
      const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => {
          console.log("reCAPTCHA solved.");
        },
        'expired-callback': () => {
          setError('reCAPTCHA expired. Please refresh and try again.');
        }
      });
      recaptchaRef.current = verifier;
      if (recaptchaRef.current) {
        window.captchaWidgetId = recaptchaRef.current.render();
      }
    } catch (e) {
      console.error("Error setting up reCAPTCHA:", e);
      setError("Failed to initialize security check. Please check Firebase configuration.");
    }

    return () => {};
  }, [auth]);

  // --- Google Login Handler ---
  const handleGoogleLogin = async () => {
    setError(''); setSuccess(''); setLoading(true);
    const provider = new GoogleAuthProvider();

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      const dbRef = ref(db);
      const userSnapshot = await get(child(dbRef, `users/${user.uid}`));

      if (userSnapshot.exists()) {
        setSuccess(`Welcome back, ${user.displayName}!`);
        navigate('/home');
      } else {
        setUserName(user.displayName || '');
        setShowProfileSetup(true);
        setSuccess('Google verification successful! Please complete your profile.');
      }

    } catch (err) {
      console.error('Google Sign In Error:', err);
      setError('Failed to sign in with Google. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 2. Function to Send the OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);

    if (!phoneNumber || !phoneNumber.startsWith('+') || phoneNumber.length < 10) {
      setError('Please enter a valid phone number including the country code (e.g., +91).');
      setLoading(false);
      return;
    }

    try {
      const appVerifier = recaptchaRef.current;
      if (!appVerifier) {
        setError('Security check (reCAPTCHA) not initialized. Please refresh.');
        setLoading(false);
        return;
      }

      // --- Quota Check for NON-TEST Numbers ---
      const isTestNumber = testNumbers.includes(phoneNumber);

      if (!isTestNumber) {
        const statsRef = ref(db, 'system_stats/otp_requests');
        const todayStr = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        let quotaExceeded = false;

        await runTransaction(statsRef, (currentData) => {
          // 1. If no data or new day, initialize count to 1 (allowing the request)
          if (!currentData || currentData.date !== todayStr) {
              return { date: todayStr, count: 1 };
          }

          // 2. If same day, check for quota
          if (currentData.count >= OTP_QUOTA_LIMIT) {
              quotaExceeded = true;
              // Returning the data unchanged aborts the write operation
              return currentData;
          }

          // 3. Increment count
          return { ...currentData, count: currentData.count + 1 };
        });

        if (quotaExceeded) {
            setError('OTP quota exhausted for the day. Please try again tomorrow.');
            setLoading(false);
            // Crucial: Reset reCAPTCHA after failure
            if (window.grecaptcha && window.captchaWidgetId !== undefined) {
              window.grecaptcha.reset(window.captchaWidgetId);
            }
            return;
        }
      }
      // Test numbers skip the quota check and increment logic completely.
      // -----------------------------------------------------------------

      // If checks passed, proceed to send SMS
      const result = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);

      setConfirmationResult(result);
      setShowOtpInput(true);
      setSuccess(`OTP sent to ${phoneNumber}.`);

    } catch (err) {
      console.error('Error sending OTP:', err);
      if (err.code === 'auth/invalid-phone-number') {
        setError('The phone number format is invalid.');
      } else if (err.code === 'auth/missing-verification-code') {
        setError('Missing verification code. Please try again.');
      } else {
        setError('Failed to send OTP. Check your number and network. (Code: ' + err.code + ');');
      }

      if (window.grecaptcha && window.captchaWidgetId !== undefined) {
        window.grecaptcha.reset(window.captchaWidgetId);
      }
    } finally {
      setLoading(false);
    }
  };

  // 3. Function to Verify the OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);

    if (!confirmationResult) {
      setError('Verification process failed. Please re-send the OTP.');
      setLoading(false);
      return;
    }
    if (otp.length !== 6) {
      setError('OTP must be exactly 6 digits.');
      setLoading(false);
      return;
    }

    try {
      const userCredential = await confirmationResult.confirm(otp);
      const user = userCredential.user;

      if (!user.displayName) {
        setShowOtpInput(false);
        setShowProfileSetup(true);
        setSuccess('Verification successful! Please complete your profile.');
      } else {
        setSuccess(`Login successful! Welcome back, ${user.displayName}.`);
        navigate('/home');
      }

    } catch (err) {
      console.error('Error verifying OTP:', err);
      if (err.code === 'auth/invalid-verification-code') {
        setError('Invalid OTP. Please check the code and try again.');
      } else {
        setError('Verification failed. Please check the OTP or try logging in again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 4. Function to Complete Profile Setup
  const handleProfileSetup = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);

    const user = auth.currentUser;
    if (!user) {
        setError('Authentication failed. Please try logging in again.');
        setLoading(false);
        return;
    }
    if (!userName.trim()) {
        setError('Please enter a valid name.');
        setLoading(false);
        return;
    }

    const userId = user.uid;

    try {
      await set(ref(db, 'users/' + userId), {
        username: userName.trim(),
        userType: userType,
        phoneNumber: user.phoneNumber || null,
        email: user.email || null,
        createdAt: new Date().toISOString()
      });

      await updateProfile(user, {
        displayName: userName.trim(),
      });

      setSuccess(`Welcome, ${userName.trim()}! Setup complete.`);
      navigate('/home');

    } catch (err) {
      console.error('Error setting up profile or saving to RTDB:', err);
      setError('Failed to save profile. Please check your RTDB rules and connection.');
    } finally {
      setLoading(false);
    }
  };

  // --- Conditional Rendering Logic ---
  const renderContent = () => {
    if (showProfileSetup) {
      return (
        <form onSubmit={handleProfileSetup}>
          <h3 className="sub-title">Complete Your Profile</h3>
          <p style={{textAlign: 'center', fontSize: '0.9rem', color: '#555', marginBottom: '15px'}}>
            {auth.currentUser?.email ? `Linked to: ${auth.currentUser.email}` : 'Please enter your details'}
          </p>

          <label className="form-label">Your Name:</label>
          <input
            type="text"
            placeholder="Enter your name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            required
            className="input-field"
          />

          <label className="form-label">User Type:</label>
          <select
            value={userType}
            onChange={(e) => setUserType(e.target.value)}
            required
            className="input-field select-field"
          >
            <option value="consumer">Consumer (Buyer only)</option>
            <option value="retailer">Retailer (Buy/Sell to Consumers/Wholesalers)</option>
            <option value="wholesaler">Wholesaler (Seller only)</option>
          </select>

          <button
            type="submit"
            disabled={loading || !userName.trim()}
            className="btn-primary btn-success"
          >
            {loading ? 'Saving...' : 'Complete Setup & Login'}
          </button>
        </form>
      );
    }

    if (showOtpInput) {
      return (
        <form onSubmit={handleVerifyOtp}>
          <h3 className="sub-title">Verify OTP</h3>
          <label className="form-label">Enter 6-Digit OTP:</label>
          <input
            type="number"
            placeholder="6-digit OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
            maxLength="6"
            className="input-field"
          />
          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="btn-primary btn-success"
          >
            {loading ? 'Verifying...' : 'Verify OTP'}
          </button>
          <button
            type="button"
            onClick={() => { setShowOtpInput(false); setError(''); setSuccess(''); }}
            className="btn-primary btn-secondary"
          >
            Change Phone Number
          </button>
        </form>
      );
    }

    return (
      <div>
        <h3 className="sub-title">Login or Register</h3>

        {/* Phone Form */}
        <form onSubmit={handleSendOtp}>
          <label className="form-label">Phone Number:</label>
          <div className="phone-input-container">
              <PhoneInput
                international
                defaultCountry="IN"
                value={phoneNumber}
                onChange={setPhoneNumber}
                placeholder="Enter phone number"
              />
          </div>
          <button
            type="submit"
            disabled={loading || !phoneNumber}
            className="btn-primary btn-send-otp"
          >
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
        </form>

        {/* Divider */}
        <div className="divider-container">
            <div className="divider-line"></div>
            <span className="divider-text">OR</span>
            <div className="divider-line"></div>
        </div>

        {/* Google Button */}
        <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="btn-primary btn-google"
        >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '10px'}}>
                <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4"/>
                <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/>
                <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957275C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
                <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335"/>
            </svg>
            {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>

      </div>
    );
  };

  return (
    <div className="full-page-container">
      <style>
        {`
        * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
        html, body { overflow: hidden; height: 100%; margin: 0; padding: 0; }
        .full-page-container {
            background: linear-gradient(135deg, #a7e0ff 0%, #a0c4ff 50%, #f6e6ff 100%);
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh; margin: 0; padding: 20px;
        }
        .glass-card {
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 16px; box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            padding: 40px; width: 90%; max-width: 450px; transition: all 0.3s ease;
        }
        .main-title { color: #1f3787; text-align: center; margin-bottom: 20px; font-weight: 800; font-size: 1.8rem; }
        .sub-title { color: #007bff; text-align: center; margin-top: 0; margin-bottom: 25px; font-weight: 600; font-size: 1.3rem; }

        .form-label { display: block; margin-bottom: 8px; color: #1f3787; font-weight: 600; font-size: 0.95rem; }
        .input-field, .select-field {
            width: 100%; padding: 12px; margin-bottom: 20px;
            border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 8px;
            background: rgba(255, 255, 255, 0.7); color: #333;
            transition: border 0.3s, background 0.3s, box-shadow 0.3s;
        }
        .input-field:focus, .select-field:focus {
            border: 1px solid #007bff; background: white; box-shadow: 0 0 5px rgba(0, 123, 255, 0.5); outline: none;
        }

        /* --- FIXED PHONE INPUT STYLES v3 --- */
        .phone-input-container {
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.7);
            box-sizing: border-box;
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding: 0 12px;
            height: 50px;
        }

        .phone-input-container .PhoneInput {
            display: flex;
            align-items: center;
            width: 100%;
            height: 100%;
        }

        /* The container for the flag and the hidden select */
        .phone-input-container .PhoneInputCountry {
            position: relative;
            display: flex;
            align-items: center;
            margin-right: 10px;
            height: 100%;
        }

        /* The native Select - Make it invisible but fill the container so it catches clicks */
        .phone-input-container .PhoneInputCountrySelect {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            border: none;
            opacity: 0;
            cursor: pointer;
        }

        /* The Flag Icon */
        .phone-input-container .PhoneInputCountryIcon {
            width: 28px;
            height: 20px;
            display: block;
        }

        .phone-input-container .PhoneInputCountryIconImg {
             width: 100%;
             height: 100%;
             display: block;
        }

        /* The Input Field */
        .phone-input-container .PhoneInputInput {
            flex: 1;
            border: none;
            background: transparent;
            outline: none;
            font-size: 16px;
            color: #333;
            height: 100%;
        }
        /* ---------------------------------- */

        /* Button Styles */
        .btn-primary {
            width: 100%; padding: 12px; border: none; border-radius: 8px; cursor: pointer;
            font-weight: bold; font-size: 1.05rem; transition: all 0.3s ease; margin-bottom: 10px;
            display: flex; justify-content: center; align-items: center;
        }
        .btn-primary:hover:not(:disabled) { transform: translateY(-2px); opacity: 0.95; box-shadow: 0 6px 10px rgba(0, 0, 0, 0.2); }
        .btn-primary:disabled { cursor: not-allowed; opacity: 0.5; transform: none; box-shadow: none; }

        .btn-send-otp { background-color: #007bff; color: white; margin-top: 20px; }
        .btn-success { background-color: #28a745; color: white; }
        .btn-secondary { background-color: #f0f0f0; color: #333; border: 1px solid #ccc; }
        .btn-google { background-color: white; color: #555; border: 1px solid #ddd; font-weight: 600; margin-top: 0px; }

        .divider-container { display: flex; align-items: center; margin: 20px 0; }
        .divider-line { flex-grow: 1; height: 1px; background-color: rgba(31, 55, 135, 0.3); }
        .divider-text { margin: 0 10px; color: #1f3787; font-size: 0.9rem; font-weight: 600; }

        .feedback-error { color: #dc3545; text-align: center; font-weight: 600; margin-bottom: 15px; }
        .feedback-success { color: #28a745; text-align: center; font-weight: 600; margin-bottom: 15px; }
        .grecaptcha-badge { display: none; }
        `}
      </style>

      <div className="glass-card">
        <h2 className="main-title">Shopping Mart Login</h2>
        {error && <p className="feedback-error">{error}</p>}
        {success && <p className="feedback-success">{success}</p>}
        {renderContent()}
        <div id="recaptcha-container"></div>
      </div>
    </div>
  );
}

export default Login;
