import React, { useState, useEffect, useRef } from 'react'; // Added useRef
import PhoneInput from 'react-phone-number-input';
// Note: In the final compiled environment, external CSS imports often fail.
// I will include the necessary PhoneInput class overrides in the component's style block below.
// import 'react-phone-number-input/style.css';
import { useNavigate } from 'react-router-dom';

// 2. Firebase Imports
import { initializeApp } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, updateProfile } from 'firebase/auth';
import { getDatabase, ref, set } from 'firebase/database';

// 3. Firebase Configuration and Initialization (Using placeholders as per instructions)
const firebaseConfig = {
  apiKey: "AIzaSyBKcJh9qUqz7D-d1XRCDVXPkBwFVeqp-x8",
  authDomain: "java-app-bd0f5.firebaseapp.com",
  projectId: "java-app-bd0f5",
  storageBucket: "java-app-bd0f5.firebasestorage.app",
  messagingSenderId: "162133264568",
  appId: "1:162133264568:web:8b3062f3a90bd25be20c4d",
  databaseURL: "https://java-app-bd0f5-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app); // Initialize Realtime Database

// 4. Main React Component
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
  const [userType, setUserType] = useState('consumer'); // Default type

  // Feedback States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // NEW: Use useRef to safely store the external RecaptchaVerifier instance
  const recaptchaRef = useRef(null);


  // 1. Setup reCAPTCHA Verifier on component mount
  useEffect(() => {
    // Check if the auth instance is available AND the RecaptchaVerifier instance is not already set in the ref
    if (!auth || recaptchaRef.current) return;

    // Initialize RecaptchaVerifier
    try {
      const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => {
          // reCAPTCHA solved automatically
          console.log("reCAPTCHA solved.");
        },
        'expired-callback': () => {
          setError('reCAPTCHA expired. Please refresh and try again.');
        }
      });

      // Store the instance in the ref
      recaptchaRef.current = verifier;

      // Render the reCAPTCHA widget
      if (recaptchaRef.current) {
        window.captchaWidgetId = recaptchaRef.current.render();
      }

    } catch (e) {
      console.error("Error setting up reCAPTCHA:", e);
      setError("Failed to initialize security check. Please check Firebase configuration.");
    }


    // The cleanup function now only handles potential manual resets if needed,
    // but avoids clearing the global instance which causes verification errors.
    return () => {
      // Explicitly leave recaptchaRef.current intact for persistence.
    };
  }, [auth]); // Dependency on auth ensures it runs after auth is initialized

// 2. Function to Send the OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);

    // This is a minimal check for phone number validity
    if (!phoneNumber || !phoneNumber.startsWith('+') || phoneNumber.length < 10) {
      setError('Please enter a valid phone number including the country code (e.g., +91).');
      setLoading(false);
      return;
    }

    try {
      // Use the Recaptcha instance stored in the ref
      const appVerifier = recaptchaRef.current;
      if (!appVerifier) {
        setError('Security check (reCAPTCHA) not initialized. Please refresh.');
        setLoading(false);
        return;
      }

      const result = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);

      setConfirmationResult(result);
      setShowOtpInput(true);
      setSuccess(`OTP sent to ${phoneNumber}.`);

    } catch (err) {
      console.error('Error sending OTP:', err);
      // Firebase specific error handling
      if (err.code === 'auth/invalid-phone-number') {
        setError('The phone number format is invalid.');
      } else if (err.code === 'auth/missing-verification-code') {
        setError('Missing verification code. Please try again.');
      } else {
        setError('Failed to send OTP. Check your number and network. (Code: ' + err.code + ')');
      }

      // Reset reCAPTCHA on error
      if (window.grecaptcha && window.captchaWidgetId !== undefined) {
        window.grecaptcha.reset(window.captchaWidgetId);
      }

    } finally {
      setLoading(false);
    }
  };

  // 3. Function to Verify the OTP and determine flow (existing or new user)
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

      // Check if profile information is missing (first-time login)
      // Note: displayName is a good proxy for first-time login via phone auth
      if (!user.displayName) {
        setShowOtpInput(false);
        setShowProfileSetup(true); // Move to profile setup screen
        setSuccess('Verification successful! Please complete your profile.');
      } else {
        // Existing user, proceed to home
        setSuccess(`Login successful! Welcome back, ${user.displayName}.`);
        navigate('/home');
      }

    } catch (err) {
      console.error('Error verifying OTP:', err);
      // Specific error for wrong OTP
      if (err.code === 'auth/invalid-verification-code') {
        setError('Invalid OTP. Please check the code and try again.');
      } else {
        setError('Verification failed. Please check the OTP or try logging in again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 4. Function to Complete Profile Setup and save to RTDB
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
      // 1. STORE DATA IN REALTIME DATABASE (RTDB)
      await set(ref(db, 'users/' + userId), {
        username: userName.trim(),
        userType: userType,
        phoneNumber: user.phoneNumber,
        createdAt: new Date().toISOString()
      });

      // 2. Update the Firebase User Profile (MANDATORY for Home page logic)
      await updateProfile(user, {
        displayName: userName.trim(),
      });

      // 3. Navigate to home
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
      // STEP 3: Profile Setup Form
      return (
        <form onSubmit={handleProfileSetup}>
          <h3 className="sub-title">Complete Your Profile</h3>

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
      // STEP 2: OTP Input Form
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

    // STEP 1: Phone Number Input Form
    return (
      <form onSubmit={handleSendOtp}>
        <h3 className="sub-title">Enter Phone Number</h3>
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
          className="btn-primary btn-send-otp" // Added specific class for styling
          style={{marginTop: '30px'}}
        >
          {loading ? 'Sending...' : 'Send OTP'}
        </button>
      </form>
    );
  };

  return (
    <div className="full-page-container">
      {/* 1. Global and Glassmorphism Styles */}
      <style>
        {`
        /* Global Reset for better aesthetics */
        * {
            box-sizing: border-box;
            font-family: 'Inter', sans-serif;
        }

        /* 1. Full Page Background for Glassmorphism Effect */
        .full-page-container {
            /* Fallback colors */
            background: #a7e0ff;
            /* Gradient background with blue/purple/pink aesthetic */
            background: linear-gradient(135deg, #a7e0ff 0%, #a0c4ff 50%, #f6e6ff 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }

        /* 2. Glassmorphism Card Container */
        .glass-card {
            background: rgba(255, 255, 255, 0.2); /* Semi-transparent white */
            backdrop-filter: blur(10px); /* The magic */
            -webkit-backdrop-filter: blur(10px); /* Safari support */
            border: 1px solid rgba(255, 255, 255, 0.3); /* Light border */
            border-radius: 16px;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37); /* Subtle shadow */
            padding: 40px;
            width: 90%;
            max-width: 450px;
            transition: all 0.3s ease;
        }

        .main-title {
            color: #1f3787; /* Dark blue/purple for contrast */
            text-align: center;
            margin-bottom: 20px;
            font-weight: 800;
            font-size: 1.8rem;
        }

        .sub-title {
            color: #007bff;
            text-align: center;
            margin-top: 0;
            margin-bottom: 25px;
            font-weight: 600;
            font-size: 1.3rem;
        }

        /* 3. Form Elements */
        .form-label {
            display: block;
            margin-bottom: 8px;
            color: #1f3787;
            font-weight: 600;
            font-size: 0.95rem;
        }

        .input-field, .select-field {
            width: 100%;
            padding: 12px;
            margin-bottom: 20px;
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.7); /* Slightly opaque input field */
            color: #333;
            transition: border 0.3s, background 0.3s, box-shadow 0.3s;
        }

        .input-field:focus, .select-field:focus {
            border: 1px solid #007bff;
            background: white;
            box-shadow: 0 0 5px rgba(0, 123, 255, 0.5);
            outline: none;
        }

        /* 4. Phone Input Specific Styling (Overrides for react-phone-number-input) */

        /* Container styling for border/background/height */
        .phone-input-container {
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.7);
            box-sizing: border-box;
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding: 0 12px; /* Padding inside the container */
            height: 48px; /* Fixed height for visual consistency */
            overflow: hidden;
        }

        /* The core PhoneInput component wrapper */
        .phone-input-container .PhoneInput {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
        }

        /* The country selector part (flag, dropdown, and code) */
        .phone-input-container .PhoneInputCountry {
            margin-right: 10px;
            background: transparent;
            height: 100%;
            display: flex;
            align-items: center;
            /* Make it slightly smaller to give more space to input */
            max-width: 100px;
        }

        /* Flag size adjustment */
        .phone-input-container .PhoneInputCountryIcon {
            width: 28px !important;
            height: 20px !important;
        }

        /* The input field for the country code selector */
        .phone-input-container .PhoneInputCountrySelect {
            border: none;
            background: transparent;
            font-size: 1rem;
            color: #333;
            padding: 0;
            height: 100%;
            cursor: pointer;
            /* Explicitly set width to accommodate flag and country code text */
            width: 100%;
        }

        /* The phone number input field itself */
        .phone-input-container .PhoneInputInput {
            border: none !important;
            background: transparent !important;
            padding: 0 !important;
            height: 100%;
            flex-grow: 1;
            color: #333;
            font-size: 1rem;
            line-height: 48px;
        }

        /* 5. Button Styling */
        .btn-primary {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            font-size: 1.05rem;
            transition: all 0.3s ease;
            margin-bottom: 10px; /* Space between buttons */
        }

        .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            opacity: 0.95;
            box-shadow: 0 6px 10px rgba(0, 0, 0, 0.2);
        }

        .btn-primary:disabled {
            cursor: not-allowed;
            opacity: 0.5;
            transform: none;
            box-shadow: none;
        }

        /* Specific Button Colors */
        .btn-send-otp {
            background-color: #007bff;
            color: white;
            box-shadow: 0 4px 6px rgba(0, 123, 255, 0.3);
        }

        .btn-success {
            background-color: #28a745;
            color: white;
            box-shadow: 0 4px 6px rgba(40, 167, 69, 0.3);
        }

        .btn-secondary {
            background-color: #f0f0f0;
            color: #333;
            border: 1px solid #ccc;
            box-shadow: none;
        }

        /* 6. Feedback messages */
        .feedback-error {
            color: #dc3545;
            text-align: center;
            font-weight: 600;
            margin-bottom: 15px;
        }
        .feedback-success {
            color: #28a745;
            text-align: center;
            font-weight: 600;
            margin-bottom: 15px;
        }

        /* --- RECAPTCHA FIX: Positioning the Badge --- */

        /* 7. Hide the mandatory anchor div to prevent it from affecting form layout */
        .grecaptcha-badge {
            display: none;
        }
        `}
      </style>

      {/* Main Login Card with Glassmorphism Effect */}
      <div className="glass-card">
        <h2 className="main-title">Shopping Mart Login</h2>

        {/* Display Messages */}
        {error && <p className="feedback-error">{error}</p>}
        {success && <p className="feedback-success">{success}</p>}

        {renderContent()}

        {/* Mandatory for Firebase reCAPTCHA - The invisible anchor element */}
        <div id="recaptcha-container"></div>
      </div>
    </div>
  );
}

export default Login;