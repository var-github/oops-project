import React, { useState, useEffect, useRef, useCallback } from 'react';
import PhoneInput from 'react-phone-number-input';
import { useNavigate } from 'react-router-dom';

// --- GOOGLE MAPS IMPORTS ---
import { GoogleMap, useJsApiLoader, Marker, Autocomplete } from '@react-google-maps/api';

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
  runTransaction
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
const MIN_PHONE_LENGTH_E164 = 13;

// Google Maps Libraries
const GOOGLE_MAPS_LIBRARIES = ['places'];
const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

// List of test numbers
const testNumbers = [
    '+919999999999', '+918888888888', '+917777777777',
    '+916666666666', '+915555555555', '+914444444444',
    '+913333333333', '+912222222222', '+911111111111'
];

// --- CUSTOM INPUT COMPONENT ---
const CustomPhoneNumberInput = React.forwardRef(({ value, onChange, ...rest }, ref) => {
  const clean = (val) => (val ? val.replace(/\s/g, '') : '');
  const formatDisplayValue = (val) => {
    const cleanVal = clean(val);
    if (cleanVal.startsWith('+91') && cleanVal.length > MIN_PHONE_LENGTH_E164) {
      val = cleanVal.slice(0, MIN_PHONE_LENGTH_E164);
    }
    const cleanedValue = clean(val);
    if (cleanedValue.startsWith('+91') && cleanedValue.length > 3) {
      const countryCode = cleanedValue.slice(0, 3);
      const localNumber = cleanedValue.slice(3);
      if (localNumber.length > 5) {
        return `${countryCode} ${localNumber.slice(0, 5)} ${localNumber.slice(5)}`;
      }
      return `${countryCode} ${localNumber}`;
    }
    return cleanedValue;
  };
  const handleChange = (e) => {
    const inputValue = e.target.value;
    const cleanInput = clean(inputValue);
    if (cleanInput.startsWith('+91') && cleanInput.length > MIN_PHONE_LENGTH_E164) return;
    onChange(e);
  };
  return (
    <input ref={ref} value={formatDisplayValue(value)} onChange={handleChange} {...rest} />
  );
});

function Login() {
  const navigate = useNavigate();

  // --- State Variables ---
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);

  const [showOtpInput, setShowOtpInput] = useState(false);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [userName, setUserName] = useState('');
  const [userType, setUserType] = useState('consumer');

  // --- Location State ---
  const [showMapModal, setShowMapModal] = useState(false);

  // storeLocation: The confirmed location displayed on the form
  const [storeLocation, setStoreLocation] = useState(null);

  // tempLocation: The location currently being moved around in the popup (before confirmation)
  const [tempLocation, setTempLocation] = useState(null);

  const [mapRef, setMapRef] = useState(null);
  const [autocompleteRef, setAutocompleteRef] = useState(null);
  const [mapCenter, setMapCenter] = useState({ lat: 20.5937, lng: 78.9629 }); // India Center default

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const recaptchaRef = useRef(null);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES
  });

  const isValidPhoneNumber = phoneNumber && phoneNumber.replace(/\s/g, '').length === MIN_PHONE_LENGTH_E164;

  // --- FIX: Inject CSS for Google Places Autocomplete Z-Index ---
  useEffect(() => {
      const style = document.createElement('style');
      style.innerHTML = `
        .pac-container {
            z-index: 10000 !important; /* Fix: Ensure suggestions appear above the modal */
            font-family: 'Inter', sans-serif;
        }
      `;
      document.head.appendChild(style);
      return () => {
          if (document.head.contains(style)) {
              document.head.removeChild(style);
          }
      };
  }, []);

  useEffect(() => {
    if (!auth || recaptchaRef.current) return;
    try {
      const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible',
        'callback': () => { console.log("reCAPTCHA solved."); },
        'expired-callback': () => { setError('reCAPTCHA expired. Please refresh.'); }
      });
      recaptchaRef.current = verifier;
      if (recaptchaRef.current) { window.captchaWidgetId = recaptchaRef.current.render(); }
    } catch (e) { console.error("Error setting up reCAPTCHA:", e); }
  }, [auth]);

  // --- GOOGLE MAPS HANDLERS ---
  const onLoadMap = useCallback((map) => { setMapRef(map); }, []);
  const onLoadAutocomplete = (autocomplete) => { setAutocompleteRef(autocomplete); };

  // --- NEW: Effect to Handle First Time vs Subsequent Time Map Center ---
  useEffect(() => {
    if (showMapModal && isLoaded) {
      // Scenario 1: User has already selected a location previously.
      // Initialize tempLocation with the saved storeLocation.
      if (storeLocation) {
        setTempLocation(storeLocation);
        setMapCenter({ lat: storeLocation.lat, lng: storeLocation.lng });

        if (mapRef) {
           mapRef.panTo({ lat: storeLocation.lat, lng: storeLocation.lng });
           mapRef.setZoom(16);
        }
      }
      // Scenario 2: First time opening map (no location selected yet).
      // Default to Current GPS location.
      else {
         // Reset temp location so the user has to pick something
         setTempLocation(null);

         if (navigator.geolocation) {
             navigator.geolocation.getCurrentPosition(
                 (position) => {
                     const lat = position.coords.latitude;
                     const lng = position.coords.longitude;

                     // Update center
                     setMapCenter({ lat, lng });

                     // OPTIONAL: Auto-select the GPS location as the temp location
                     // If you want the user to explicitly click/drag, remove the next line.
                     handleLocationSelection(lat, lng);

                     if (mapRef) {
                         mapRef.panTo({ lat, lng });
                         mapRef.setZoom(16);
                     }
                 },
                 (error) => {
                     console.log("GPS permission denied or error, keeping default center.");
                 }
             );
         }
      }
    }
  }, [showMapModal, isLoaded, storeLocation, mapRef]);

  // Unified Helper to update TEMP location state and fetch address via Reverse Geocoding
  // Note: This does NOT update storeLocation anymore.
  const handleLocationSelection = (lat, lng) => {
    setMapCenter({ lat, lng });

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results[0]) {
            setTempLocation({ lat, lng, address: results[0].formatted_address });
        } else {
            setTempLocation({ lat, lng, address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
        }
    });
  };

  // "Confirm" Button Handler
  const handleConfirmLocation = () => {
      if (tempLocation) {
          setStoreLocation(tempLocation);
          setShowMapModal(false);
      }
  };

  const onPlaceChanged = () => {
    if (autocompleteRef !== null) {
      const place = autocompleteRef.getPlace();
      if (place.geometry && place.geometry.location) {
        const newLat = place.geometry.location.lat();
        const newLng = place.geometry.location.lng();

        setMapCenter({ lat: newLat, lng: newLng });
        handleLocationSelection(newLat, newLng);

        if(mapRef) {
            mapRef.panTo({ lat: newLat, lng: newLng });
            mapRef.setZoom(16);
        }
      }
    }
  };

  const onMapClick = useCallback((e) => {
    const newLat = e.latLng.lat();
    const newLng = e.latLng.lng();
    handleLocationSelection(newLat, newLng);
  }, []);

  const onMarkerDragEnd = (e) => {
    const newLat = e.latLng.lat();
    const newLng = e.latLng.lng();
    handleLocationSelection(newLat, newLng);
  };

  const handleUseCurrentLocation = () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                setMapCenter({ lat, lng });
                handleLocationSelection(lat, lng);
                if(mapRef) {
                    mapRef.panTo({ lat, lng });
                    mapRef.setZoom(16);
                }
            },
            (error) => {
                console.error("Error getting location:", error);
                alert("Could not fetch current location.");
            }
        );
    }
  };

  // --- AUTH HANDLERS ---
  const handleGoogleLogin = async () => {
    setError(''); setSuccess(''); setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const dbRef = ref(db);
      const snapshot = await get(child(dbRef, `users/${user.uid}`));
      if (snapshot.exists()) {
        setSuccess(`Welcome back!`);
        navigate('/home');
      } else {
        setUserName(user.displayName || '');
        setShowProfileSetup(true);
        setSuccess('Google verification successful! Please complete your profile.');
      }
    } catch (err) { setError('Failed to sign in with Google.'); }
    finally { setLoading(false); }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    const cleanPhone = phoneNumber ? phoneNumber.replace(/\s/g, '') : '';

    if (!isValidPhoneNumber) {
        setError('Please enter a valid 10-digit phone number.');
        setLoading(false);
        return;
    }

    try {
      const appVerifier = recaptchaRef.current;
      if (!appVerifier) throw new Error('Recaptcha not loaded');

      const isTestNumber = testNumbers.includes(cleanPhone);
      if (!isTestNumber) {
        const statsRef = ref(db, 'system_stats/otp_requests');
        const todayStr = new Date().toISOString().split('T')[0];
        let quotaExceeded = false;
        await runTransaction(statsRef, (data) => {
          if (!data || data.date !== todayStr) return { date: todayStr, count: 1 };
          if (data.count >= OTP_QUOTA_LIMIT) { quotaExceeded = true; return data; }
          return { ...data, count: data.count + 1 };
        });
        if (quotaExceeded) {
            setError('OTP quota exhausted today.');
            setLoading(false);
            if (window.grecaptcha) window.grecaptcha.reset(window.captchaWidgetId);
            return;
        }
      }

      const result = await signInWithPhoneNumber(auth, cleanPhone, appVerifier);
      setConfirmationResult(result);
      setShowOtpInput(true);
      setSuccess(`OTP sent to ${cleanPhone}.`);
    } catch (err) {
      console.error(err);
      setError('Failed to send OTP. ' + err.message);
      if (window.grecaptcha) window.grecaptcha.reset(window.captchaWidgetId);
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    if (!confirmationResult || otp.length !== 6) { setError('Invalid OTP.'); setLoading(false); return; }
    try {
      const cred = await confirmationResult.confirm(otp);
      if (!cred.user.displayName) {
        setShowOtpInput(false);
        setShowProfileSetup(true);
        setSuccess('Verification successful! Please complete your profile.');
      } else {
        navigate('/home');
      }
    } catch (err) { setError('Invalid OTP. Please try again.'); }
    finally { setLoading(false); }
  };

  // --- PROFILE SETUP (STRICT LOCATION LOGIC) ---
  const handleProfileSetup = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    // 1. Identify if this user type REQUIRES a location
    const isBusinessUser = userType === 'retailer' || userType === 'wholesaler';

    // 2. Validate Location only for Business Users
    if (isBusinessUser && !storeLocation) {
        setError('Please select your store/godown location on the map.');
        return;
    }

    setLoading(true);
    try {
      // 3. Construct Payload
      const payload = {
        username: userName.trim(),
        userType, // 'consumer', 'retailer', or 'wholesaler'
        phoneNumber: user.phoneNumber,
        email: user.email,
        createdAt: new Date().toISOString()
      };

      // 4. STRICTLY only add location if it is a Business User
      if (isBusinessUser && storeLocation) {
          payload.storeLocation = storeLocation;
      }

      await set(ref(db, 'users/' + user.uid), payload);
      await updateProfile(user, { displayName: userName.trim() });
      navigate('/home');
    } catch (err) { setError('Failed to save profile.'); }
    finally { setLoading(false); }
  };

  // --- RENDER HELPERS ---
  const renderMapModal = () => {
      if (!showMapModal || !isLoaded) return null;
      return (
          <div className="map-modal-overlay">
              <div className="map-modal-content">
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: '15px'}}>
                      <h3 style={{color: '#007bff', margin: 0, fontSize: '1.3rem'}}>📍 Pin Location</h3>
                      <button onClick={() => setShowMapModal(false)} style={{background:'none', border:'none', fontSize:'1.5rem', cursor:'pointer', color:'#666'}}>✖</button>
                  </div>

                  <Autocomplete onLoad={onLoadAutocomplete} onPlaceChanged={onPlaceChanged}>
                      <input type="text" placeholder="Search for area, street name..." className="input-field map-search-box" />
                  </Autocomplete>

                  <div className="map-container-wrapper">
                    <GoogleMap
                        mapContainerStyle={{ width: '100%', height: '100%' }}
                        center={mapCenter}
                        zoom={5}
                        onLoad={onLoadMap}
                        onClick={onMapClick}
                        options={{
                            streetViewControl: false,
                            mapTypeControl: false,
                            fullscreenControl: false
                        }}
                    >
                        <Marker
                            position={mapCenter}
                            draggable={true}
                            onDragEnd={onMarkerDragEnd}
                            animation={window.google.maps.Animation.DROP}
                        />
                    </GoogleMap>
                  </div>

                  <p style={{fontSize: '0.8em', color:'#666', textAlign:'center', marginTop: '-10px', marginBottom: '15px'}}>
                      * Drag marker or click map to refine location
                  </p>

                  {/* Selected Address Bar is REMOVED as requested */}

                  <div style={{display: 'flex', gap: '10px', marginTop: 'auto'}}>
                    <button type="button" className="btn-primary btn-secondary" style={{flex: 1}} onClick={handleUseCurrentLocation}>
                        📡 Use Current Location
                    </button>
                    <button
                        type="button"
                        className="btn-primary btn-success"
                        style={{flex: 1}}
                        onClick={handleConfirmLocation}
                        disabled={!tempLocation} // Disable if nothing is selected yet
                    >
                        Confirm Location
                    </button>
                  </div>
              </div>
          </div>
      );
  };

  const renderContent = () => {
    if (showProfileSetup) {
      // Check if UI should show location options
      const needsLocation = userType === 'retailer' || userType === 'wholesaler';

      return (
        <form onSubmit={handleProfileSetup}>
          <h3 className="sub-title">Complete Your Profile</h3>
          <label className="form-label">Your Name:</label>
          <input type="text" value={userName} onChange={(e)=>setUserName(e.target.value)} required className="input-field" placeholder="Enter Name" />

          <label className="form-label">User Type:</label>
          <select value={userType} onChange={(e)=>setUserType(e.target.value)} className="input-field select-field">
            <option value="consumer">Consumer</option>
            <option value="retailer">Retailer</option>
            <option value="wholesaler">Wholesaler</option>
          </select>

          {/* LOCATION SECTION: Only visible if NOT consumer */}
          {needsLocation && (
              <div style={{marginBottom: '20px'}}>
                  <label className="form-label">Store/Godown Location:</label>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{background: '#fff', color: '#007bff', border: '1px solid #007bff'}}
                    onClick={() => setShowMapModal(true)}
                  >
                      {storeLocation ? 'Change Location 📍' : 'Select Location on Map 📍'}
                  </button>
                  {storeLocation && (
                      <div style={{fontSize: '0.85rem', color: '#333', marginTop: '5px', background: 'rgba(255,255,255,0.5)', padding: '8px', borderRadius: '5px'}}>
                          ✓ {storeLocation.address}
                      </div>
                  )}
              </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary btn-success">
            {loading ? 'Saving...' : 'Complete Setup'}
          </button>
        </form>
      );
    }

    if (showOtpInput) {
      return (
        <form onSubmit={handleVerifyOtp}>
          <h3 className="sub-title">Verify OTP</h3>
          <label className="form-label">Enter 6-Digit OTP:</label>
          <input type="number" placeholder="******" value={otp} onChange={(e)=>setOtp(e.target.value)} required maxLength="6" className="input-field" />
          <button type="submit" disabled={loading || otp.length !== 6} className="btn-primary btn-success">
            {loading ? 'Verifying...' : 'Verify OTP'}
          </button>
          <button type="button" onClick={()=>{setShowOtpInput(false); setError('');}} className="btn-primary btn-secondary">Back</button>
        </form>
      );
    }

    return (
      <div>
        <h3 className="sub-title">Login or Register</h3>
        <form onSubmit={handleSendOtp}>
          <label className="form-label">Phone Number:</label>
          <div className="phone-input-container">
             <PhoneInput
                international
                defaultCountry="IN"
                value={phoneNumber}
                onChange={setPhoneNumber}
                placeholder="Enter 10-digit number"
                inputComponent={CustomPhoneNumberInput}
              />
          </div>
          <button type="submit" disabled={loading || !isValidPhoneNumber} className="btn-primary btn-send-otp">
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
        </form>

        <div className="divider-container">
            <div className="divider-line"></div><span className="divider-text">OR</span><div className="divider-line"></div>
        </div>

        <button type="button" onClick={handleGoogleLogin} disabled={loading} className="btn-primary btn-google">
             <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '8px'}}>
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
            min-height: 100vh; padding: 20px;
        }
        .glass-card {
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 16px; box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            padding: 40px; width: 90%; max-width: 450px;
            position: relative; z-index: 1;
        }
        .main-title { color: #1f3787; text-align: center; margin-bottom: 20px; font-weight: 800; font-size: 1.8rem; }
        .sub-title { color: #007bff; text-align: center; margin-top: 0; margin-bottom: 25px; font-weight: 600; font-size: 1.3rem; }
        .form-label { display: block; margin-bottom: 8px; color: #1f3787; font-weight: 600; font-size: 0.95rem; }
        .input-field, .select-field {
            width: 100%; padding: 12px; margin-bottom: 20px;
            border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 8px;
            background: rgba(255, 255, 255, 0.7); color: #333;
        }
        .input-field:focus { border: 1px solid #007bff; background: white; outline: none; }
        .phone-input-container {
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.7);
            display: flex; align-items: center;
            margin-bottom: 20px; padding: 0 12px; height: 50px;
            transition: all 0.3s ease;
        }
        .phone-input-container:focus-within { border-color: #007bff; background: white; }
        .grecaptcha-badge{display: none;}
        .phone-input-container .PhoneInput { display: flex; align-items: center; width: 100%; height: 100%; }
        .phone-input-container .PhoneInputCountry { position: relative; display: flex; align-items: center; margin-right: 12px; height: 100%; }
        .phone-input-container .PhoneInputCountrySelect { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 1; }
        .phone-input-container .PhoneInputCountryIcon { width: 28px; height: 20px; display: block; }
        .phone-input-container .PhoneInputCountryIconImg { width: 100%; height: 100%; display: block; }
        .phone-input-container input {
            flex: 1; border: none; background: transparent; outline: none;
            font-size: 16px; color: #333; height: 100%; letter-spacing: 0.5px;
        }
        .btn-primary {
            width: 100%; padding: 12px; border: none; border-radius: 8px; cursor: pointer;
            font-weight: bold; font-size: 1.05rem; transition: all 0.3s ease; margin-bottom: 10px;
            display: flex; justify-content: center; align-items: center;
        }
        .btn-primary:hover:not(:disabled) { transform: translateY(-2px); opacity: 0.95; box-shadow: 0 6px 10px rgba(0,0,0,0.2); }
        .btn-primary:disabled { cursor: not-allowed; opacity: 0.5; transform: none; box-shadow: none; }
        .btn-send-otp { background-color: #007bff; color: white; margin-top: 20px; }
        .btn-success { background-color: #28a745; color: white; }
        .btn-secondary { background-color: #f0f0f0; color: #333; border: 1px solid #ccc; }
        .btn-google { background-color: white; color: #555; border: 1px solid #ddd; }
        .divider-container { display: flex; align-items: center; margin: 20px 0; }
        .divider-line { flex-grow: 1; height: 1px; background-color: rgba(31, 55, 135, 0.3); }
        .divider-text { margin: 0 10px; color: #1f3787; font-size: 0.9rem; font-weight: 600; }
        .feedback-error { color: #dc3545; text-align: center; font-weight: 600; margin-bottom: 15px; }
        .feedback-success { color: #28a745; text-align: center; font-weight: 600; margin-bottom: 15px; }
        .map-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); z-index: 999;
            display: flex; justify-content: center; align-items: center;
            padding: 20px;
        }
        .map-modal-content {
            background: white; padding: 20px; border-radius: 16px;
            width: 100%; max-width: 600px; height: 80vh;
            display: flex; flex-direction: column;
        }
        .map-container-wrapper {
            flex: 1; border: 2px solid #ddd; border-radius: 8px; overflow: hidden; margin-bottom: 15px; position: relative;
        }
        .map-search-box { margin-bottom: 10px !important; border: 1px solid #ccc !important; }
        .selected-address-box {
            font-size: 0.9rem; background: #f8f9fa; padding: 10px;
            border-radius: 6px; border: 1px solid #eee; margin-bottom: 10px;
        }
        `}
      </style>

      {renderMapModal()}

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
