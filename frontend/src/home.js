import React, { useState, useEffect, useRef } from 'react';
import { getAuth, signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { getDatabase, ref, get, set, onValue, remove, push, runTransaction, update } from 'firebase/database';
import { initializeApp } from "firebase/app";
import './Home.css';

// --- START: Firebase Configuration (REPLACE WITH YOUR ACTUAL CONFIG) ---
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
const db = getDatabase(app);
const auth = getAuth(app);
// --- END: Firebase Configuration ---

// --- HELPER: Haversine Formula to calculate distance ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;

    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// --- HELPER: Load Google Maps Script ---
const loadGoogleMapsScript = (callback) => {
    const existingScript = document.getElementById('googleMapsScript');
    if (existingScript) {
        if (window.google && window.google.maps && window.google.maps.places) {
            callback();
        } else {
            existingScript.addEventListener('load', callback);
        }
        return;
    }

    const script = document.createElement('script');
    script.id = 'googleMapsScript';
    // libraries=places IS REQUIRED for search suggestions
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
        if (callback) callback();
    };
    document.body.appendChild(script);
};


function HomePage() {
  const navigate = useNavigate();
  const user = auth.currentUser;
  const userId = user ? user.uid : null;

  // --- State for User Data & Flow ---
  const [currentUserType, setCurrentUserType] = useState(null);
  const [loadingUserType, setLoadingUserType] = useState(true);
  const [activeView, setActiveView] = useState('retailer_marketplace');
  const [showProductForm, setShowProductForm] = useState(false);
  const [showCartPopup, setShowCartPopup] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  // --- NEW STATE for Location ---
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('Acquiring location...');
  const [manualAddress, setManualAddress] = useState('');
  const [showLocationPopup, setShowLocationPopup] = useState(false);
  const [mapsLoaded, setMapsLoaded] = useState(false);

  // --- Refs for Maps ---
  const addressInputRef = useRef(null);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerInstanceRef = useRef(null);

  // FIX: Create a ref to hold the latest userLocation.
  const latestLocationRef = useRef(userLocation);

  // --- NEW STATE for Product Details Popup ---
  const [selectedProduct, setSelectedProduct] = useState(null);

  // --- NEW STATE for Order Status Popup (Buyer) ---
  const [selectedOrderForStatus, setSelectedOrderForStatus] = useState(null);

  // --- NEW STATE for Reviews ---
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [targetReviewProduct, setTargetReviewProduct] = useState(null); // { productId, productName, orderId }
  const [reviewData, setReviewData] = useState({ rating: 0, comment: '' });

  // --- NEW STATE for Search & Sort ---
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('default'); // default, price_asc, price_desc, rating, distance
  const [showSortDropdown, setShowSortDropdown] = useState(false);


  // --- Notification State ---
  const [notification, setNotification] = useState(null);

  // --- Product & Cart & Order States ---
  const [wholesalerProducts, setWholesalerProducts] = useState([]);
  const [retailerProducts, setRetailerProducts] = useState([]);
  const [myProducts, setMyProducts] = useState([]);
  const [cartItems, setCartItems] = useState({});
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [editingProduct, setEditingProduct] = useState(null);

  // --- MODIFIED ORDER STATES ---
  const [buyerOrders, setBuyerOrders] = useState([]); // Orders where user is the Buyer (Purchase History)
  const [sellerOrders, setSellerOrders] = useState([]); // Orders where user is the Seller (Revenue Dashboard)
  const [totalRevenue, setTotalRevenue] = useState(0); // Total accumulated revenue

  // --- Form States (Used for both ADD and EDIT) ---
  const [productName, setProductName] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productQuantity, setProductQuantity] = useState('');
  const [minOrderQuantity, setMinOrderQuantity] = useState('');
  const [productPhoto, setProductPhoto] = useState(null);
  const [addProductLoading, setAddProductLoading] = useState(false);
  const [addProductError, setAddProductError] = useState('');
  const [addProductSuccess, setAddProductSuccess] = useState('');

  // --- NEW STATE for Account Dropdown (Mobile Only) ---
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);

  // --- NEW STATE for Marketplace Dropdown (Mobile Only, Retailer) ---
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);

  // --- FIX: Sync the Ref with State ---
  useEffect(() => {
      latestLocationRef.current = userLocation;
  }, [userLocation]);

  // --- Load Google Maps & Get Initial Geolocation ---
  useEffect(() => {
      // 1. Load Google Maps API
      loadGoogleMapsScript(() => {
          setMapsLoaded(true);
      });

      // 2. Get Browser Location
      if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
              (position) => {
                  setUserLocation({
                      lat: position.coords.latitude,
                      lng: position.coords.longitude
                  });
                  setLocationStatus('Current GPS Location');
              },
              (error) => {
                  console.log("Location access denied or unavailable:", error);
                  setLocationStatus('Location permission denied or unavailable');
              }
          );
      } else {
          setLocationStatus('Geolocation not supported by this browser');
      }
  }, []);

  // --- FIX: Always Re-Initialize Map when Popup Opens ---
  useEffect(() => {
      if (showLocationPopup && mapsLoaded) {

          // A. Initialize Map (FORCE NEW INSTANCE every time popup opens)
          if (mapContainerRef.current) {
               // FIX: Use the Ref to get the absolute latest location, not the stale closure variable
               const center = latestLocationRef.current || { lat: 20.5937, lng: 78.9629 };

               const map = new window.google.maps.Map(mapContainerRef.current, {
                   center: center,
                   zoom: latestLocationRef.current ? 15 : 5, // Zoom in if we have a location
                   mapTypeControl: false,
                   streetViewControl: false,
                   fullscreenControl: false
               });
               mapInstanceRef.current = map;

               const marker = new window.google.maps.Marker({
                   position: center,
                   map: map,
                   draggable: true,
                   title: "Delivery Location",
                   animation: window.google.maps.Animation.DROP
               });
               markerInstanceRef.current = marker;

               // Helper: Update location when map is clicked or marker dragged
               const updateFromMap = (latLng) => {
                   const lat = latLng.lat();
                   const lng = latLng.lng();
                   setUserLocation({ lat, lng });

                   // Reverse Geocode to get address text
                   const geocoder = new window.google.maps.Geocoder();
                   geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                       if (status === "OK" && results[0]) {
                           const address = results[0].formatted_address;
                           setManualAddress(address);
                           setLocationStatus(address);
                           if (addressInputRef.current) {
                               addressInputRef.current.value = address;
                           }
                       } else {
                           setManualAddress(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                           setLocationStatus("Custom Map Location");
                       }
                   });
               };

               // Event: Drag End
               marker.addListener("dragend", () => {
                   updateFromMap(marker.getPosition());
               });

               // Event: Map Click
               map.addListener("click", (e) => {
                   marker.setPosition(e.latLng);
                   updateFromMap(e.latLng);
               });
          }

          // B. Initialize Autocomplete (Bind to the new map instance)
          if (addressInputRef.current && mapInstanceRef.current) {
              // CRITICAL: Pre-fill the input with the current address so user sees what is selected
              if (manualAddress) {
                  addressInputRef.current.value = manualAddress;
              }

              const autocomplete = new window.google.maps.places.Autocomplete(addressInputRef.current, {
                  types: ['geocode'], // Limit to addresses
                  fields: ['geometry', 'formatted_address']
              });

              // Bind autocomplete to map bounds for better local results
              autocomplete.bindTo('bounds', mapInstanceRef.current);

              autocomplete.addListener('place_changed', () => {
                  const place = autocomplete.getPlace();
                  if (!place.geometry || !place.geometry.location) {
                      setNotification('⚠️ No details available for input: ' + place.name);
                      return;
                  }

                  const lat = place.geometry.location.lat();
                  const lng = place.geometry.location.lng();

                  // Update State
                  setUserLocation({ lat, lng });
                  setManualAddress(place.formatted_address);
                  setLocationStatus(place.formatted_address);

                  // Update Map
                  if (mapInstanceRef.current && markerInstanceRef.current) {
                      const newPos = { lat, lng };
                      mapInstanceRef.current.setCenter(newPos);
                      mapInstanceRef.current.setZoom(16);
                      markerInstanceRef.current.setPosition(newPos);
                  }

                  setNotification('✅ Location updated!');
              });
          }
      }
  }, [showLocationPopup, mapsLoaded]);

  // --- Data Fetching Logic (UPDATED FOR SEPARATE ORDERS/REVENUE) ---
  useEffect(() => {
    if (!userId) {
      navigate('/');
      return;
    }

    const fetchUserType = async () => {
      try {
        const userRef = ref(db, 'users/' + userId);
        const snapshot = await get(userRef);
        if (snapshot.exists()) {
          const type = snapshot.val().userType;
          setCurrentUserType(type);

          // Set initial view based on user type after loading
          if (type === 'wholesaler') {
              setActiveView('catalog');
          } else if (type === 'retailer') {
              // Retailers default to the Wholesale Market
              setActiveView('marketplace');
          } else {
              // Consumers default to the Retailer Market
              setActiveView('retailer_marketplace');
          }

        }
      } catch (error) {
        console.error('Error fetching user type:', error);
      } finally {
        setLoadingUserType(false);
      }
    };

    const productsRef = ref(db, 'products');
    setLoadingProducts(true);

    const unsubscribeProducts = onValue(productsRef, async (snapshot) => {
      const productData = snapshot.val();
      const loadedWholesalerProducts = [];
      const loadedRetailerProducts = [];
      const loadedMyProducts = [];

      let usersData = {};

      if (productData) {
          // Fetch all user types once to efficiently categorize products and get Store Locations
          const usersSnapshot = await get(ref(db, 'users'));
          usersData = usersSnapshot.val() || {};

          for (let key in productData) {
              const sellerId = productData[key].wholesalerId;
              const sellerData = usersData[sellerId];
              const sellerType = sellerData?.userType;
              const storeLocation = sellerData?.storeLocation; // Fetch store location {lat, lng, address}

              // Merge store location into the product object
              const product = {
                  id: key,
                  ...productData[key],
                  storeLocation: storeLocation
              };

              if (sellerId === userId) {
                  // Product listed by current user
                  loadedMyProducts.push(product);
              } else if (sellerType === 'wholesaler') {
                  // Product listed by a Wholesaler (Primary Marketplace)
                  loadedWholesalerProducts.push(product);
              } else if (sellerType === 'retailer') {
                  // Product listed by a Retailer (Retailer Marketplace)
                  loadedRetailerProducts.push(product);
              }
          }
      }

      setWholesalerProducts(loadedWholesalerProducts);
      setRetailerProducts(loadedRetailerProducts);
      setMyProducts(loadedMyProducts);
      setLoadingProducts(false);

      if (editingProduct) {
          const updatedEditingProduct = loadedMyProducts.find(p => p.id === editingProduct.id);
          if (!updatedEditingProduct) {
              setEditingProduct(null);
          }
      }
    }, (error) => {
        console.error("Error reading products:", error);
        setLoadingProducts(false);
    });

    // Fetch and Subscribe to Cart Items
    const cartRef = ref(db, `carts/${userId}`);
    const unsubscribeCart = onValue(cartRef, (snapshot) => {
        if (snapshot.exists()) {
            setCartItems(snapshot.val());
        } else {
            setCartItems({});
        }
    }, (error) => {
        console.error("Error reading cart items:", error);
    });

    // NEW: Fetch and Subscribe to Orders (Split into Buyer/Seller)
    const ordersRef = ref(db, `orders`);
    const unsubscribeOrders = onValue(ordersRef, (snapshot) => {
        if (!userId) return; // Ensure user is logged in

        const allOrders = snapshot.val() || {};
        const loadedBuyerOrders = [];
        const loadedSellerOrders = [];
        let calculatedRevenue = 0;

        // Filter orders based on user's role (Buyer or Seller)
        for (const orderId in allOrders) {
            const order = { id: orderId, ...allOrders[orderId] };

            // 1. Check if the current user is the BUYER (Purchase History)
            if (order.buyerId === userId) {
                loadedBuyerOrders.push({ ...order, role: 'Buyer' });
            }

            // 2. Check if the current user is a SELLER in any item (Revenue Dashboard & Pending Orders)
            if (currentUserType === 'wholesaler' || currentUserType === 'retailer') {
                const sellerItems = order.items.filter(item => item.wholesalerId === userId);

                if (sellerItems.length > 0) {
                    const revenueForThisOrder = sellerItems.reduce((sum, item) => sum + item.subtotal, 0);

                    // CRITICAL UPDATE: Get the specific status for THIS seller from the map
                    const mySellerStatus = order.sellerStatuses && order.sellerStatuses[userId]
                                         ? order.sellerStatuses[userId]
                                         : 'Pending';

                    // UPDATED LOGIC: Only add to revenue if status is 'Delivered'
                    if (mySellerStatus === 'Delivered') {
                        calculatedRevenue += revenueForThisOrder;
                    }

                    // Create a seller-centric view of the order
                    loadedSellerOrders.push({
                        ...order,
                        items: sellerItems,
                        totalPrice: revenueForThisOrder, // The 'totalPrice' here is the revenue for this specific seller
                        status: mySellerStatus, // OVERWRITE global status with specific seller status for the view
                        role: 'Seller',
                    });
                }
            }
        }

        // Sort by timestamp (most recent first)
        loadedBuyerOrders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        loadedSellerOrders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        setBuyerOrders(loadedBuyerOrders);
        setSellerOrders(loadedSellerOrders);
        setTotalRevenue(calculatedRevenue);

    }, (error) => {
        console.error("Error reading orders:", error);
    });
    // END NEW ORDER FETCHING

    fetchUserType();

    return () => {
        unsubscribeProducts();
        unsubscribeCart();
        unsubscribeOrders();
    };
  }, [userId, navigate, currentUserType]);

  // --- Notification Timeout Effect ---
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // --- Utility Handlers ---

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
      alert('Logout failed. Please try again.');
    }
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) { setProductPhoto(file); setAddProductError(''); } else { setProductPhoto(null); }
  };

  const handleAddProductClick = () => {
    setEditingProduct(null);
    setProductName(''); setProductPrice(''); setProductQuantity(''); setProductPhoto(null);
    setMinOrderQuantity('');
    setAddProductError(''); setAddProductSuccess('');
    setShowProductForm(true);
  };

  const handleNavClick = (view) => {
      setActiveView(view);
      setShowProductForm(false);
      setEditingProduct(null);
      setShowCheckout(false);
      setSearchQuery('');
      setShowAccountDropdown(false);
      setShowMarketDropdown(false);
      setSortOption('default');
  };

  const handleUpdateOrderStatus = async (orderId, newStatus) => {
      try {
          const statusRef = ref(db, `orders/${orderId}/sellerStatuses/${userId}`);
          await set(statusRef, newStatus);
          setNotification(`✅ Order status updated to **${newStatus}**`);
      } catch (error) {
          console.error("Error updating status:", error);
          setNotification("🚨 Failed to update order status.");
      }
  };

  // --- REVIEW LOGIC ---

  const handleOpenReview = (item, orderId) => {
      setTargetReviewProduct({ productId: item.productId, productName: item.productName, orderId });
      setReviewData({ rating: 0, comment: '' });
      setShowReviewModal(true);
  };

  const handleSubmitReview = async (e) => {
      e.preventDefault();
      if (reviewData.rating === 0) {
          setNotification('⚠️ Please select a star rating.');
          return;
      }

      const { productId, productName } = targetReviewProduct;

      try {
          const productRef = ref(db, `products/${productId}`);

          // Use transaction to atomically update review list and average
          await runTransaction(productRef, (product) => {
              if (product) {
                  if (!product.reviews) {
                      product.reviews = {};
                  }

                  // Add/Overwrite review by this user
                  product.reviews[userId] = {
                      rating: reviewData.rating,
                      comment: reviewData.comment,
                      userName: user.displayName || 'Anonymous',
                      timestamp: new Date().toISOString()
                  };

                  // Recalculate Average
                  const reviews = Object.values(product.reviews);
                  const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
                  product.averageRating = totalRating / reviews.length;
                  product.reviewCount = reviews.length;
              }
              return product;
          });

          setNotification(`✅ Review submitted for **${productName}**!`);
          setShowReviewModal(false);
          setTargetReviewProduct(null);
      } catch (error) {
          console.error("Error submitting review:", error);
          setNotification("🚨 Failed to submit review.");
      }
  };

  // --- Cart Adjustment Logic ---

  const adjustCartQuantitiesAfterUpdate = async (productId, newAvailableQuantity, currentWholesalerId) => {
    const cartsRef = ref(db, 'carts');
    try {
        const snapshot = await get(cartsRef);
        const allCarts = snapshot.val();
        if (!allCarts) return;

        for (const retailerId in allCarts) {
            const retailerCart = allCarts[retailerId];
            if (retailerCart[currentWholesalerId]) {
                const cartItem = retailerCart[currentWholesalerId][productId];
                if (cartItem) {
                    const currentQuantity = cartItem.quantity;
                    const cartItemRef = ref(db, `carts/${retailerId}/${currentWholesalerId}/${productId}`);

                    if (currentQuantity > newAvailableQuantity) {
                        if (newAvailableQuantity > 0) {
                            await set(cartItemRef, { productId: productId, wholesalerId: currentWholesalerId, quantity: newAvailableQuantity });
                        } else {
                            await remove(cartItemRef);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error adjusting cart quantities:', error);
    }
  };

  const adjustCartQuantitiesForMOQ = async (productId, newMOQ, currentWholesalerId) => {
    const cartsRef = ref(db, 'carts');
    try {
        const snapshot = await get(cartsRef);
        const allCarts = snapshot.val();
        if (!allCarts) return;

        const productList = [...wholesalerProducts, ...retailerProducts, ...myProducts];
        const productDetails = productList.find(p => p.id === productId);
        const maxStock = productDetails ? productDetails.quantity : 0;
        const productName = productDetails?.name || 'product';

        for (const retailerId in allCarts) {
            const retailerCart = allCarts[retailerId];
            if (retailerCart[currentWholesalerId]) {
                const cartItem = retailerCart[currentWholesalerId][productId];
                if (cartItem && cartItem.quantity < newMOQ) {
                    const cartItemRef = ref(db, `carts/${retailerId}/${currentWholesalerId}/${productId}`);
                    if (newMOQ > maxStock) {
                         await remove(cartItemRef);
                         setNotification(`📢 ${productName} removed from one or more carts because **MOQ (${newMOQ})** exceeds stock.`);
                    } else {
                        await set(cartItemRef, { productId: productId, wholesalerId: currentWholesalerId, quantity: newMOQ });
                        setNotification(`📢 Cart quantity for ${productName} in one or more carts adjusted to meet **MOQ of ${newMOQ}**.`);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error adjusting cart quantities for MOQ:', error);
    }
  };


  // --- ADD/EDIT/DELETE Logic ---
  const handleStartEdit = (product) => {
    setShowProductForm(false);
    setShowCheckout(false);
    setShowCartPopup(false);
    setActiveView('catalog');
    setEditingProduct(product);
    setProductName(product.name);
    setProductPrice(product.price.toString());
    setProductQuantity(product.quantity.toString());
    setMinOrderQuantity(product.minOrderQuantity ? product.minOrderQuantity.toString() : '1');
    setProductPhoto(null);
    setAddProductError('');
    setAddProductSuccess('');
  };

  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    setAddProductLoading(true); setAddProductError(''); setAddProductSuccess('');

    if (!productName || !productPrice || !productQuantity || !editingProduct) {
      setAddProductError('Please fill all required fields.'); setAddProductLoading(false); return;
    }

    const newQuantity = parseInt(productQuantity, 10);
    const newMOQ = Math.max(1, parseInt(minOrderQuantity, 10) || 1);

    try {
      let photoBase64 = productPhoto ? await fileToBase64(productPhoto) : editingProduct.photoBase64;
      const productRef = ref(db, 'products/' + editingProduct.id);
      const oldQuantity = editingProduct.quantity;
      const oldMOQ = editingProduct.minOrderQuantity || 1;

      const updatedProductData = {
          ...editingProduct,
          name: productName,
          price: parseFloat(productPrice),
          quantity: newQuantity,
          photoBase64: photoBase64,
          updatedAt: new Date().toISOString(),
          minOrderQuantity: newMOQ,
      };

      await set(productRef, updatedProductData);

      if (newQuantity < oldQuantity) {
        await adjustCartQuantitiesAfterUpdate(editingProduct.id, newQuantity, userId);
      }
      if (newMOQ > oldMOQ) {
        await adjustCartQuantitiesForMOQ(editingProduct.id, newMOQ, userId);
      }

      setAddProductSuccess(`Product "${productName}" updated successfully!`);
      setEditingProduct(null);
      setAddProductLoading(false);
      setProductName(''); setProductPrice(''); setProductQuantity(''); setProductPhoto(null);
      setMinOrderQuantity('');
    } catch (error) {
      console.error('Error updating product:', error);
      setAddProductError('Failed to update product: ' + error.message);
      setAddProductLoading(false);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    setAddProductLoading(true); setAddProductError(''); setAddProductSuccess('');
    if (!productName || !productPrice || !productQuantity || !productPhoto) {
      setAddProductError('Please fill all fields and select a photo.');
      setAddProductLoading(false); return;
    }
    try {
      const photoBase64 = await fileToBase64(productPhoto);
      const newProductRef = ref(db, 'products/' + Date.now());
      const parsedMinOrderQuantity = Math.max(1, parseInt(minOrderQuantity, 10) || 1);

      await set(newProductRef, {
        name: productName, price: parseFloat(productPrice), quantity: parseInt(productQuantity, 10),
        photoBase64: photoBase64, wholesalerId: userId, wholesalerName: user.displayName || 'Unknown Seller',
        createdAt: new Date().toISOString(),
        minOrderQuantity: parsedMinOrderQuantity,
        averageRating: 0,
        reviewCount: 0
      });
      setAddProductSuccess(`Product "${productName}" added successfully!`);
      setShowProductForm(false);
      handleNavClick('catalog');
    } catch (error) {
      console.error('Error adding product:', error);
      setAddProductError('Failed to add product.');
    } finally {
      setAddProductLoading(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!window.confirm(`Are you sure you want to delete the product: "${product.name}"? This action cannot be undone and will remove it from all retailer carts.`)) {
      return;
    }
    try {
      const productRef = ref(db, 'products/' + product.id);
      await remove(productRef);
      await adjustCartQuantitiesAfterUpdate(product.id, 0, userId);
      setNotification(`🗑️ Product "${product.name}" deleted successfully.`);
      if (editingProduct?.id === product.id) {
          setEditingProduct(null);
      }
    } catch (error) {
      console.error('Error deleting product:', error);
      setNotification(`🚨 Failed to delete "${product.name}".`);
    }
  };

  // --- Cart Logic ---

  const updateCartItem = async (product, requestedQuantity) => {
    const sellerId = product.wholesalerId;
    const productId = product.id;
    const cartItemRef = ref(db, `carts/${userId}/${sellerId}/${productId}`);
    const moq = product.minOrderQuantity || 1;
    let newQuantity = Math.max(0, parseInt(requestedQuantity, 10) || 0);

    const allProducts = [...wholesalerProducts, ...retailerProducts, ...myProducts];
    const marketplaceProduct = allProducts.find(p => p.id === productId);
    const availableStock = marketplaceProduct ? marketplaceProduct.quantity : 0;

    if (newQuantity > availableStock) {
        newQuantity = availableStock;
        if (availableStock === 0) {
            setNotification(`🚫 "${product.name}" is **Out of Stock**!`);
        } else {
            setNotification(`⚠️ Max quantity for "${product.name}" is **${availableStock}**.`);
        }
    }

    if (newQuantity > 0 && newQuantity < moq) {
        if (moq <= availableStock) {
            newQuantity = moq;
            setNotification(`⚠️ Quantity corrected to **MOQ of ${moq}** for ${product.name}.`);
        } else {
            newQuantity = 0;
            setNotification(`🚫 ${product.name} cannot meet minimum order quantity of **${moq}** (Out of stock).`);
        }
    }

    try {
        if (newQuantity === 0) {
            await remove(cartItemRef);
            if (requestedQuantity !== 0) {
                 setNotification(`🗑️ Removed ${product.name} from cart.`);
            }
        } else {
            await set(cartItemRef, {
                productId: productId,
                wholesalerId: sellerId,
                quantity: newQuantity,
            });
            if (newQuantity !== requestedQuantity) {
                 setNotification(`✅ Quantity for ${product.name} updated to **${newQuantity}**.`);
            }
        }
    } catch (error) {
        console.error(`Error updating cart quantity for ${product.name}:`, error);
    }
  };

  const handleUpdateCartQuantity = (product, change) => {
    const sellerId = product.wholesalerId;
    const productId = product.id;
    const currentQuantity = cartItems[sellerId]?.[productId]?.quantity || 0;
    let requestedQuantity;

    if (change === -1 && currentQuantity <= (product.minOrderQuantity || 1) && currentQuantity > 0) {
        requestedQuantity = 0;
    } else {
        requestedQuantity = currentQuantity + change;
    }
    updateCartItem(product, requestedQuantity);
  };

  const handleAddToCart = (product) => {
      const moq = product.minOrderQuantity || 1;
      const sellerId = product.wholesalerId;
      const productId = product.id;
      const currentQuantity = cartItems[sellerId]?.[productId]?.quantity || 0;
      const requestedQuantity = currentQuantity === 0 ? moq : currentQuantity + 1;
      updateCartItem(product, requestedQuantity);
  };

  // --- Order Placement Logic (WITH PAYMENT POPUP) ---

  const getCartDisplayItems = () => {
    const allAvailableProducts = [...wholesalerProducts, ...retailerProducts, ...myProducts];
    const allAvailableProductsMap = allAvailableProducts.reduce((acc, product) => {
        acc[product.id] = product;
        return acc;
    }, {});

    return Object.values(cartItems).flatMap(Object.values).map(cartItem => {
        const productDetails = allAvailableProductsMap[cartItem.productId];
        if (productDetails) {
            const moq = productDetails.minOrderQuantity || 1;
            return {
                ...cartItem,
                name: productDetails.name,
                price: productDetails.price,
                photoBase64: productDetails.photoBase64,
                wholesalerName: productDetails.wholesalerName,
                isOverstocked: cartItem.quantity > productDetails.quantity,
                isBelowMOQ: cartItem.quantity < moq,
                availableStock: productDetails.quantity,
                subtotal: cartItem.quantity * productDetails.price,
                moq: moq,
            };
        }
        return {
            ...cartItem,
            name: 'DELETED PRODUCT',
            price: 0,
            subtotal: 0,
            isDeleted: true
        };
    });
  };

  // 1. Triggered by "Confirm Order" button - NOW OPENS RAZRAZORPAY
  const startPaymentProcess = () => {
      const items = getCartDisplayItems();
      const invalidItems = items.filter(item => item.isDeleted || item.isOverstocked || item.isBelowMOQ);

      if (invalidItems.length > 0) {
          setNotification('🚨 Cannot place order: Check cart for errors.');
          setShowCheckout(false);
          setShowCartPopup(true);
          return;
      }
      if (items.length === 0) {
          setNotification('🚨 Your cart is empty.');
          setShowCheckout(false);
          return;
      }

      // Calculate total
      const totalOrderPrice = items.reduce((total, item) => total + item.subtotal, 0);

      // Open Razorpay Checkout
      openRazorpayCheckout(totalOrderPrice);
  };

  // 2. NEW: Open Razorpay Checkout
  const openRazorpayCheckout = (amount) => {
      const options = {
          key: process.env.REACT_APP_RAZORPAY_KEY_ID,
          amount: Math.round(amount * 100), // Razorpay expects amount in paise
          currency: 'INR',
          name: 'Shopping Mart',
          description: 'Order Payment',
          image: '', // Optional: Add your logo URL
          handler: function (response) {
              // Payment successful
              finalizeOrder(response.razorpay_payment_id, response.razorpay_order_id, response.razorpay_signature);
          },
          prefill: {
              name: user?.displayName || '',
              email: user?.email || '',
              contact: user?.phoneNumber || ''
          },
          theme: {
              color: '#007bff'
          },
          modal: {
              ondismiss: function() {
                  setNotification('⚠️ Payment cancelled');
                  setShowCheckout(true);
              }
          }
      };

      const razorpay = new window.Razorpay(options);
      razorpay.open();
  };

  // 3. UPDATED: The Actual Database Write (now accepts payment IDs)
  const finalizeOrder = async (razorpayPaymentId = null, razorpayOrderId = null, razorpaySignature = null) => {
      const items = getCartDisplayItems();
      // Calculate total again for security
      const totalOrderPrice = items.reduce((total, item) => total + item.subtotal, 0);

      const sellerStatuses = {};
      const uniqueSellers = [...new Set(items.map(item => item.wholesalerId))];
      uniqueSellers.forEach(sellerId => {
          sellerStatuses[sellerId] = 'Pending';
      });

      const orderData = {
          buyerId: userId,
          buyerName: user.displayName || 'Unknown User',
          timestamp: new Date().toISOString(),
          totalPrice: totalOrderPrice,
          sellerStatuses: sellerStatuses,
          // NEW: Payment tracking
          paymentStatus: razorpayPaymentId ? 'paid' : 'pending',
          razorpay_payment_id: razorpayPaymentId || null,
          razorpay_order_id: razorpayOrderId || null,
          razorpay_signature: razorpaySignature || null,
          items: items.map(item => ({
              productId: item.productId,
              wholesalerId: item.wholesalerId,
              productName: item.name,
              price: item.price,
              quantity: item.quantity,
              subtotal: item.subtotal,
              wholesalerName: item.wholesalerName,
          }))
      };

      try {
          const stockDeductionPromises = items.map(item => {
              const productRef = ref(db, `products/${item.productId}`);
              return runTransaction(productRef, (currentData) => {
                  if (currentData) {
                      const availableStock = currentData.quantity;
                      const purchaseQuantity = item.quantity;
                      if (availableStock < purchaseQuantity) return;
                      currentData.quantity = availableStock - purchaseQuantity;
                      return currentData;
                  } else {
                      return;
                  }
              });
          });

          const transactionResults = await Promise.all(stockDeductionPromises);
          const failedTransaction = transactionResults.find(result => !result || !result.committed);

          if (failedTransaction) {
              setNotification('🚨 Order failed! Stock changed during checkout.');
              setShowCheckout(false);
              return;
          }

          const ordersRef = ref(db, 'orders');
          await push(ordersRef, orderData);
          const cartRef = ref(db, `carts/${userId}`);
          await remove(cartRef);

          setCartItems({});
          setShowCheckout(false);
          setNotification(`🎉 Order placed successfully! Total: **₹ ${totalOrderPrice.toFixed(2)}**. Payment ID: ${razorpayPaymentId}`);
          const defaultView = currentUserType === 'wholesaler' ? 'catalog' : 'marketplace';
          setActiveView(defaultView);
      } catch (error) {
          console.error('Error placing order:', error);
          setNotification('🚨 Failed to place order.');
      }
  };

  // --- Components ---

  const CartQuantityControl = ({ product }) => {
    const sellerId = product.wholesalerId;
    const productId = product.id;
    const currentQuantity = cartItems[sellerId]?.[productId]?.quantity || 0;
    const [inputValue, setInputValue] = useState(currentQuantity);

    useEffect(() => { setInputValue(currentQuantity); }, [currentQuantity]);
    const handleInput = (e) => { setInputValue(e.target.value); };
    const submitChange = () => {
        let newValue = parseInt(inputValue, 10);
        if (isNaN(newValue) || newValue < 0) newValue = 0;
        if (newValue !== currentQuantity) updateCartItem(product, newValue);
    };
    const handleKeyDown = (e) => { if (e.key === 'Enter') { submitChange(); e.target.blur(); } };

    return (
      <div className="quantity-control-container">
        <button onClick={() => handleUpdateCartQuantity(product, -1)} className="quantity-btn decrement" disabled={currentQuantity === 0}>-</button>
        <input type="number" value={inputValue} onChange={handleInput} onBlur={submitChange} onKeyDown={handleKeyDown} min="0" className="quantity-input"/>
        <button onClick={() => handleUpdateCartQuantity(product, 1)} className="quantity-btn increment">+</button>
      </div>
    );
  };

  const NotificationPopup = () => {
    if (!notification) return null;
    const renderMessage = () => {
      const parts = notification.split(/(\*\*.*?\*\*)/g);
      return parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
        return part;
      });
    };
    return <div className="notification-popup">{renderMessage()}</div>;
  };

  // --- NEW: Render Star Rating Helper ---
  const renderStars = (rating) => {
      const stars = [];
      for (let i = 1; i <= 5; i++) {
          stars.push(
              <span key={i} style={{ color: i <= rating ? 'gold' : '#ccc', fontSize: '1.1em' }}>
                  ★
              </span>
          );
      }
      return stars;
  };

  // --- NEW: Helper Function for Sorting Products ---
  const applySort = (products) => {
      const sorted = [...products];
      switch (sortOption) {
          case 'price_asc':
              return sorted.sort((a, b) => a.price - b.price);
          case 'price_desc':
              return sorted.sort((a, b) => b.price - a.price);
          case 'rating':
              return sorted.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));
          case 'distance':
              if (!userLocation) return sorted;
              return sorted.sort((a, b) => {
                  const distA = a.storeLocation && a.storeLocation.lat ? calculateDistance(userLocation.lat, userLocation.lng, a.storeLocation.lat, a.storeLocation.lng) : 99999;
                  const distB = b.storeLocation && b.storeLocation.lat ? calculateDistance(userLocation.lat, userLocation.lng, b.storeLocation.lat, b.storeLocation.lng) : 99999;
                  return (distA || 99999) - (distB || 99999);
              });
          default:
              return sorted;
      }
  };

  // --- NEW: Reusable Sort Dropdown Component ---
  const renderSortMenu = () => (
      <div style={{
          position: 'absolute',
          right: 0,
          top: '110%',
          backgroundColor: 'white',
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: '12px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
          zIndex: 1000,
          minWidth: '200px',
          overflow: 'hidden',
          animation: 'fadeInSlide 0.2s ease-out',
          padding: '8px 0'
      }}>
          <div style={{ padding: '8px 16px', fontSize: '0.75em', textTransform: 'uppercase', color: '#888', letterSpacing: '1px', fontWeight: 'bold' }}>
              Sort By
          </div>
          {['default', 'price_asc', 'price_desc', 'rating', 'distance'].map(optionKey => {
              const labels = {
                  default: 'Recommended',
                  price_asc: 'Price: Low to High',
                  price_desc: 'Price: High to Low',
                  rating: 'Rating: High to Low',
                  distance: 'Distance: Nearest First'
              };
              const isActive = sortOption === optionKey;

              return (
                  <div
                      key={optionKey}
                      onClick={() => { setSortOption(optionKey); setShowSortDropdown(false); }}
                      style={{
                          padding: '10px 16px',
                          cursor: 'pointer',
                          backgroundColor: isActive ? 'var(--color-primary-light, #e6f7ff)' : 'transparent',
                          color: isActive ? 'var(--color-primary, #007bff)' : '#333',
                          fontWeight: isActive ? '600' : '400',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '0.95rem',
                          transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = '#f9f9f9'; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                      {labels[optionKey]}
                      {isActive && <span>✓</span>}
                  </div>
              );
          })}
      </div>
  );


  // --- NEW: Location Change Popup with MAP ---
  const renderLocationPopup = () => {
      if (!showLocationPopup) return null;

      const handleResetLocation = () => {
          if (navigator.geolocation) {
              setLocationStatus('Acquiring location...');
              navigator.geolocation.getCurrentPosition(
                  (position) => {
                      const lat = position.coords.latitude;
                      const lng = position.coords.longitude;
                      setUserLocation({ lat, lng });
                      setLocationStatus('Current GPS Location');
                      setManualAddress('');

                      // Update map
                      if (mapInstanceRef.current && markerInstanceRef.current) {
                          const newPos = { lat, lng };
                          mapInstanceRef.current.setCenter(newPos);
                          mapInstanceRef.current.setZoom(15);
                          markerInstanceRef.current.setPosition(newPos);
                      }

                      setNotification("✅ Reset to GPS location.");
                  },
                  (error) => {
                      console.error(error);
                      setNotification("🚨 Error getting GPS location.");
                  }
              );
          }
      };

      return (
          <div className="product-detail-overlay" onClick={(e) => {
              if (e.target.classList.contains('product-detail-overlay')) setShowLocationPopup(false);
          }}>
              <div className="form-container" style={{backgroundColor: 'white', maxWidth: '500px', width: '90%'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: '15px'}}>
                      <h3 style={{color: 'var(--color-primary)', margin: 0}}>📍 Select Delivery Location</h3>
                      <button onClick={() => setShowLocationPopup(false)} style={{background:'none', border:'none', fontSize:'1.5rem', cursor:'pointer', color:'#666'}}>✖</button>
                  </div>

                  <div className="form-group">
                      <input
                          ref={addressInputRef}
                          type="text"
                          className="form-control"
                          placeholder={mapsLoaded ? "Search for area, street name..." : "Loading Maps..."}
                          disabled={!mapsLoaded}
                      />
                  </div>

                  {/* MAP CONTAINER */}
                  <div
                      ref={mapContainerRef}
                      style={{
                          width: '100%',
                          height: '300px',
                          borderRadius: '8px',
                          marginTop: '15px',
                          marginBottom: '15px',
                          border: '1px solid #ccc'
                      }}
                  ></div>
                  <p style={{fontSize: '0.8em', color:'#666', textAlign:'center', marginTop: '-10px', marginBottom: '15px'}}>
                      * Drag marker or click map to refine location
                  </p>

                  <div style={{display:'flex', gap: '10px'}}>
                      <button onClick={handleResetLocation} className="btn-secondary" style={{flex: 1}}>
                          📡 Use Current Location
                      </button>
                      <button onClick={() => setShowLocationPopup(false)} className="btn-primary" style={{flex: 1}}>
                          Confirm Location
                      </button>
                  </div>
              </div>
          </div>
      );
  };

  // --- UPDATED: Product Detail Popup (With Reviews) ---
  const renderProductDetailPopup = () => {
    if (!selectedProduct) return null;

    const product = selectedProduct;
    const moq = product.minOrderQuantity || 1;
    const currentQuantity = cartItems[product.wholesalerId]?.[product.id]?.quantity || 0;
    const isOutOfStock = product.quantity <= 0;
    const isInCart = currentQuantity > 0;

    // Get Reviews
    const reviews = product.reviews ? Object.values(product.reviews) : [];
    const avgRating = product.averageRating || 0;
    const reviewCount = product.reviewCount || 0;

    // Calculate Distance in popup
    let distanceStr = null;
    if (userLocation && product.storeLocation && product.storeLocation.lat && product.storeLocation.lng) {
        const d = calculateDistance(userLocation.lat, userLocation.lng, product.storeLocation.lat, product.storeLocation.lng);
        distanceStr = d ? `${d.toFixed(1)} km away` : null;
    }

    return (
      <div className="product-detail-overlay" onClick={(e) => {
        if (e.target.classList.contains('product-detail-overlay')) setSelectedProduct(null);
      }}>
        <div className="product-detail-content">
          <button className="close-btn" onClick={() => setSelectedProduct(null)}>✖</button>

          <div className="detail-header">
            <h3>{product.name}</h3>
            <p className="seller-name">Seller: {product.wholesalerName}</p>
             {distanceStr && <p style={{color: '#007bff', fontWeight: '500', margin: '5px 0'}}>📍 {distanceStr}</p>}
            <div style={{marginTop: '5px'}}>
                {renderStars(Math.round(avgRating))}
                <span style={{color:'#666', marginLeft:'5px', fontSize:'0.9em'}}>
                     ({avgRating.toFixed(1)}) - {reviewCount} Reviews
                </span>
            </div>
          </div>

          <div className="detail-body">
            <div className="detail-photo-container">
              <img src={product.photoBase64} alt={product.name} className="detail-photo-simple" />
            </div>

            <div className="detail-info">
              <p className="detail-price">Price: <span>₹ {product.price.toFixed(2)}</span></p>
              <p>Available Stock: <span>{product.quantity} units</span></p>
              <p className="detail-moq">Minimum Order Quantity (MOQ): <span>{moq} units</span></p>

              <div className="detail-actions">
                {isOutOfStock ? (
                    <button className="btn-out-of-stock" disabled>🚫 Out of Stock</button>
                ) : (
                    <>
                    <p style={{ marginTop: '15px', marginBottom: '5px' }}>Adjust Quantity:</p>
                    {isInCart ? <CartQuantityControl product={product} /> :
                        <button onClick={() => handleAddToCart(product)} className="btn-add-to-cart btn-primary">
                          🛒 Add {moq} to Cart
                        </button>
                    }
                    </>
                )}
              </div>
            </div>
          </div>

          {/* REVIEWS SECTION */}
          <div className="reviews-section" style={{marginTop: '30px', borderTop: '1px solid #eee', paddingTop: '20px'}}>
              <h4 style={{color: 'var(--color-primary)', marginBottom: '15px'}}>Customer Reviews</h4>
              {reviews.length === 0 ? (
                  <p style={{fontStyle: 'italic', color: '#777'}}>No reviews yet.</p>
              ) : (
                  <div className="reviews-list" style={{maxHeight: '200px', overflowY: 'auto'}}>
                      {reviews.map((review, index) => (
                          <div key={index} style={{backgroundColor: '#f9f9f9', padding: '10px', borderRadius: '8px', marginBottom: '10px'}}>
                              <div style={{display:'flex', justifyContent:'space-between'}}>
                                  <span style={{fontWeight:'bold'}}>{review.userName}</span>
                                  <span>{renderStars(review.rating)}</span>
                              </div>
                              {review.comment && <p style={{margin: '5px 0 0 0', color: '#555', fontSize: '0.95em'}}>"{review.comment}"</p>}
                          </div>
                      ))}
                  </div>
              )}
          </div>
        </div>
      </div>
    );
  };

  // --- NEW: Review Form Modal ---
  const renderReviewModal = () => {
      if (!showReviewModal) return null;

      return (
          <div className="product-detail-overlay" style={{zIndex: 5000}}>
              <div className="form-container" style={{backgroundColor: 'white', maxWidth: '400px', width: '90%'}}>
                   <h3 className="section-header" style={{color: 'var(--color-primary)', marginBottom: '15px'}}>
                       Write a Review ✍️
                   </h3>
                   <p style={{marginBottom: '20px'}}>Product: <strong>{targetReviewProduct?.productName}</strong></p>

                   <form onSubmit={handleSubmitReview}>
                       <div className="form-group">
                           <label>Rating (Required)</label>
                           <div style={{fontSize: '2rem', cursor: 'pointer'}}>
                               {[1, 2, 3, 4, 5].map((star) => (
                                   <span
                                       key={star}
                                       onClick={() => setReviewData({...reviewData, rating: star})}
                                       style={{color: star <= reviewData.rating ? 'gold' : '#ccc', marginRight: '5px'}}
                                   >
                                       ★
                                   </span>
                               ))}
                           </div>
                       </div>

                       <div className="form-group">
                           <label>Comment (Optional)</label>
                           <textarea
                               className="form-control"
                               rows="3"
                               placeholder="Share your experience..."
                               value={reviewData.comment}
                               onChange={(e) => setReviewData({...reviewData, comment: e.target.value})}
                           ></textarea>
                       </div>

                       <div className="form-action-buttons">
                           <button type="submit" className="btn-primary btn-full-width">Submit Review</button>
                           <button type="button" onClick={() => setShowReviewModal(false)} className="btn-secondary btn-full-width">Cancel</button>
                       </div>
                   </form>
              </div>
          </div>
      );
  };

  const renderStatusPopup = () => {
      if (!selectedOrderForStatus) return null;
      const steps = ['Pending', 'Confirmed', 'Dispatched', 'Delivered'];
      const order = selectedOrderForStatus;
      const itemsBySeller = {};
      order.items.forEach(item => {
          if (!itemsBySeller[item.wholesalerId]) itemsBySeller[item.wholesalerId] = { name: item.wholesalerName, items: [] };
          itemsBySeller[item.wholesalerId].items.push(item);
      });

      return (
          <div className="product-detail-overlay" onClick={(e) => {
              if (e.target.classList.contains('product-detail-overlay')) setSelectedOrderForStatus(null);
          }}>
              <div className="product-detail-content" style={{ maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto' }}>
                  <button className="close-btn" onClick={() => setSelectedOrderForStatus(null)}>✖</button>
                  <h3 className="section-header">Order Status 📦</h3>
                  <p style={{marginBottom: '20px'}}><strong>Order ID:</strong> {order.id.substring(0,10)}...</p>
                  {Object.entries(itemsBySeller).map(([sellerId, data], idx) => {
                      const status = order.sellerStatuses && order.sellerStatuses[sellerId] ? order.sellerStatuses[sellerId] : 'Pending';
                      const currentStepIndex = steps.indexOf(status);
                      return (
                        <div key={sellerId} style={{ marginBottom: '30px', borderBottom: idx < Object.keys(itemsBySeller).length - 1 ? '1px dashed #ccc' : 'none', paddingBottom: '20px' }}>
                            <h4 style={{color: 'var(--color-primary)', margin: '0 0 10px 0'}}>Seller: {data.name}</h4>
                            <div className="status-timeline" style={{marginBottom: '15px'}}>
                                {steps.map((step, index) => (
                                    <div key={step} className={`timeline-step ${index <= currentStepIndex ? 'active' : ''}`}>
                                        <div className="timeline-icon">{index <= currentStepIndex ? '✔️' : '⚪'}</div>
                                        <div className="timeline-label">{step}</div>
                                        {index < steps.length - 1 && <div className={`timeline-line ${index < currentStepIndex ? 'active' : ''}`}></div>}
                                    </div>
                                ))}
                            </div>
                            <div style={{backgroundColor: '#f9f9f9', padding: '10px', borderRadius: '8px'}}>
                                <p style={{fontSize: '0.9em', fontWeight: 'bold', marginBottom: '5px'}}>Items included:</p>
                                <ul style={{margin: 0, paddingLeft: '20px', fontSize: '0.9em', color: '#555'}}>
                                    {data.items.map((item, itemIdx) => (<li key={itemIdx}>{item.productName} (x{item.quantity})</li>))}
                                </ul>
                            </div>
                        </div>
                      );
                  })}
              </div>
          </div>
      );
  };


  const renderProductForm = (isEditing) => (
    <div className="form-container" style={{ border: `1px solid var(${isEditing ? '--color-warning' : '--color-primary'})`, maxWidth: '700px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '25px' }}>
             <h3 style={{ color: `var(${isEditing ? '--color-warning' : '--color-primary'})`, fontSize: '1.8rem', margin: '0' }}>
                {isEditing ? '✏️ Edit Product' : '📦 Add New Product'}
            </h3>
            <p style={{ color: 'var(--color-secondary)', marginTop: '5px' }}>
                {isEditing ? `Updating: ${editingProduct.name}` : 'Fill in the details to list your product.'}
            </p>
        </div>

        {addProductError && <div className="form-error" style={{ textAlign: 'center', marginBottom: '15px' }}>{addProductError}</div>}
        {addProductSuccess && <div className="form-success" style={{ textAlign: 'center', marginBottom: '15px' }}>{addProductSuccess}</div>}

        <form onSubmit={isEditing ? handleUpdateProduct : handleAddProduct}>
          <div className="form-group">
            <label>Product Name</label>
            <input type="text" className="form-control" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g., Organic Almonds 500g" required />
          </div>
          <div className="form-grid">
              <div className="form-group">
                <label>Price (₹)</label>
                <input type="number" className="form-control" value={productPrice} onChange={(e) => setProductPrice(e.target.value)} required min="0.01" step="0.01" placeholder="0.00" />
              </div>
              <div className="form-group">
                <label>Stock Quantity</label>
                <input type="number" className="form-control" value={productQuantity} onChange={(e) => setProductQuantity(e.target.value)} required min="1" step="1" placeholder="Available units" />
              </div>
          </div>
          <div className="form-grid">
              <div className="form-group">
                <label>Minimum Order Qty (MOQ)</label>
                <input type="number" className="form-control" value={minOrderQuantity} onChange={(e) => setMinOrderQuantity(e.target.value)} min="1" step="1" placeholder="Default: 1" />
              </div>
              <div className="form-group">
                 <label>{isEditing ? 'Update Photo (Optional)' : 'Product Photo'}</label>
                 <input type="file" accept="image/*" onChange={handlePhotoChange} required={!isEditing} style={{ padding: '8px' }} />
              </div>
          </div>
          {(productPhoto || (isEditing && editingProduct.photoBase64)) && (
              <div className="image-preview-container">
                  <p style={{ fontSize: '0.8em', color: '#666', marginBottom: '5px' }}>Preview:</p>
                  <img src={productPhoto ? URL.createObjectURL(productPhoto) : editingProduct.photoBase64} alt="Preview" style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: '8px' }} />
              </div>
          )}
          <div className="form-action-buttons" style={{ marginTop: '30px' }}>
            {isEditing ? (
                <>
                    <button type="submit" disabled={addProductLoading} className="btn-warning btn-full-width">{addProductLoading ? 'Saving...' : 'Save Changes'}</button>
                    <button type="button" onClick={() => setEditingProduct(null)} className="btn-secondary btn-full-width">Cancel</button>
                </>
            ) : (
                <>
                    <button type="submit" disabled={addProductLoading} className="btn-primary btn-full-width">{addProductLoading ? 'Processing...' : 'Save Product'}</button>
                    <button type="button" onClick={() => setShowProductForm(false)} className="btn-secondary btn-full-width">Cancel</button>
                </>
            )}
          </div>
        </form>
    </div>
  );

  const renderMyProductsList = () => (
    <div style={{ marginTop: '20px' }}>
      <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>My Product Catalog ({myProducts.length})</h3>
      {myProducts.length === 0 ? (
        <p>You have not added any products yet. Click the "➕" button to start.</p>
      ) : (
        <div className="product-grid">
          {myProducts.map((product) => (
            <div key={product.id} className="product-card" style={{ backgroundColor: editingProduct?.id === product.id ? 'var(--color-warning-light)' : 'var(--color-bg-card)' }}>
              <img src={product.photoBase64} alt={product.name} />
              <p className="product-name">{product.name}</p>
              <p className="product-price">Stock: {product.quantity} units (₹ {product.price.toFixed(2)})</p>
              <div style={{margin: '5px 0', color: '#777', fontSize: '0.9em'}}>
                   {product.averageRating ? `★ ${product.averageRating.toFixed(1)}` : 'No ratings'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '5px', marginTop: '10px' }}>
                <button onClick={() => handleDeleteProduct(product)} disabled={!!editingProduct} className="btn-danger btn-icon-only" title="Delete Product">🗑️</button>
                <button onClick={() => handleStartEdit(product)} disabled={!!editingProduct} className="btn-info btn-edit" title="Edit Product">✏️ Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderWholesalerMarketplace = () => {
    let filteredProducts = wholesalerProducts.filter(product => product.name.toLowerCase().includes(searchQuery.toLowerCase()));
    // APPLY SORT
    filteredProducts = applySort(filteredProducts);

    return (
      <div style={{ marginTop: '20px' }}>
        <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>Wholesale Marketplace ({wholesalerProducts.length})</h3>

        {/* DISPLAY CURRENT LOCATION HEADER */}
        <div
            onClick={() => setShowLocationPopup(true)}
            style={{marginBottom: '15px', color: '#666', fontSize: '0.9em', borderLeft: '4px solid var(--color-primary)', paddingLeft: '10px', backgroundColor: 'rgba(255,255,255,0.5)', padding: '5px', cursor: 'pointer', transition: 'background-color 0.2s'}}
            onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.8)'}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.5)'}
        >
            📍 Delivery Location: <strong>{manualAddress || locationStatus}</strong> {userLocation && `(${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)})`}
            <span style={{float:'right', color:'var(--color-primary)', fontWeight:'bold'}}>Change ✎</span>
        </div>

        {/* SEARCH & SORT BAR */}
        <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', position: 'relative' }}>
            <input
                type="text"
                placeholder="🔍 Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, padding: '12px', borderRadius: 'var(--border-radius)', border: '1px solid #ccc', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)' }}
            />
            <div style={{position: 'relative'}}>
                <button
                    onClick={() => setShowSortDropdown(!showSortDropdown)}
                    className="btn-secondary"
                    style={{ height: '100%', padding: '0 15px', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                    ⇅ Sort
                </button>
                {showSortDropdown && renderSortMenu()}
            </div>
        </div>

        {filteredProducts.length === 0 ? <p>{searchQuery ? 'No products match your search.' : 'No products currently listed.'}</p> : (
          <div className="product-grid">
            {filteredProducts.map((product) => {
              const currentQuantity = cartItems[product.wholesalerId]?.[product.id]?.quantity || 0;
              const isOutOfStock = product.quantity <= 0;
              const isInCart = currentQuantity > 0;
              const moq = product.minOrderQuantity || 1;

              // Calculate distance
              let distanceStr = null;
              if (userLocation && product.storeLocation && product.storeLocation.lat && product.storeLocation.lng) {
                  const d = calculateDistance(userLocation.lat, userLocation.lng, product.storeLocation.lat, product.storeLocation.lng);
                  distanceStr = d ? `${d.toFixed(1)} km` : null;
              }

              return (
                <div key={product.id} className="product-card" style={{ opacity: isOutOfStock ? 0.6 : 1, cursor: 'pointer' }} onClick={() => setSelectedProduct(product)}>
                  <div>
                    <img src={product.photoBase64} alt={product.name} />
                    <p className="product-name">{product.name}</p>
                    <p className="product-price">Price: ₹ {product.price.toFixed(2)}</p>

                    {/* Distance Badge */}
                    {distanceStr && (
                        <div style={{display: 'inline-block', backgroundColor: '#e9f5ff', color: '#007bff', fontSize: '0.8em', padding: '3px 8px', borderRadius: '10px', marginBottom: '5px', fontWeight: 'bold'}}>
                             📍 {distanceStr}
                        </div>
                    )}

                    <div style={{margin: '5px 0', color: '#777', fontSize: '0.85em'}}>
                       {product.averageRating ? `★ ${product.averageRating.toFixed(1)} (${product.reviewCount})` : 'No ratings yet'}
                    </div>
                    <p className="product-moq-label">MOQ: {moq}</p>
                  </div>
                  {isInCart ? <div onClick={(e) => e.stopPropagation()}><CartQuantityControl product={product} /></div> :
                      <button onClick={(e) => { e.stopPropagation(); handleAddToCart(product); }} disabled={isOutOfStock} className="btn-add-to-cart">{isOutOfStock ? '🚫 Out of Stock' : `🛒 Add (Min ${moq})`}</button>
                  }
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderRetailerMarketplace = () => {
    let filteredProducts = retailerProducts.filter(product => product.name.toLowerCase().includes(searchQuery.toLowerCase()));
    // APPLY SORT
    filteredProducts = applySort(filteredProducts);

    return (
      <div style={{ marginTop: '20px' }}>
        <h3 className="section-header" style={{ color: 'var(--color-info)' }}>Retailer Marketplace ({retailerProducts.length})</h3>

        {/* DISPLAY CURRENT LOCATION HEADER */}
        <div
            onClick={() => setShowLocationPopup(true)}
            style={{marginBottom: '15px', color: '#666', fontSize: '0.9em', borderLeft: '4px solid var(--color-info)', paddingLeft: '10px', backgroundColor: 'rgba(255,255,255,0.5)', padding: '5px', cursor: 'pointer', transition: 'background-color 0.2s'}}
            onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.8)'}
            onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.5)'}
        >
            📍 Delivery Location: <strong>{manualAddress || locationStatus}</strong> {userLocation && `(${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)})`}
            <span style={{float:'right', color:'var(--color-info)', fontWeight:'bold'}}>Change ✎</span>
        </div>

        {/* SEARCH & SORT BAR */}
        <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', position: 'relative' }}>
            <input
                type="text"
                placeholder="🔍 Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, padding: '12px', borderRadius: 'var(--border-radius)', border: '1px solid #ccc', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)' }}
            />
            <div style={{position: 'relative'}}>
                <button
                    onClick={() => setShowSortDropdown(!showSortDropdown)}
                    className="btn-secondary"
                    style={{ height: '100%', padding: '0 15px', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                    ⇅ Sort
                </button>
                {showSortDropdown && renderSortMenu()}
            </div>
        </div>

        {filteredProducts.length === 0 ? <p>{searchQuery ? 'No products match your search.' : 'No products currently listed.'}</p> : (
          <div className="product-grid">
            {filteredProducts.map((product) => {
              const currentQuantity = cartItems[product.wholesalerId]?.[product.id]?.quantity || 0;
              const isOutOfStock = product.quantity <= 0;
              const isInCart = currentQuantity > 0;
              const moq = product.minOrderQuantity || 1;

              // Calculate distance
              let distanceStr = null;
              if (userLocation && product.storeLocation && product.storeLocation.lat && product.storeLocation.lng) {
                  const d = calculateDistance(userLocation.lat, userLocation.lng, product.storeLocation.lat, product.storeLocation.lng);
                  distanceStr = d ? `${d.toFixed(1)} km` : null;
              }

              return (
                <div key={product.id} className="product-card" style={{ opacity: isOutOfStock ? 0.6 : 1, cursor: 'pointer' }} onClick={() => setSelectedProduct(product)}>
                  <div>
                    <img src={product.photoBase64} alt={product.name} />
                    <p className="product-name">{product.name}</p>
                    <p className="product-price">Price: ₹ {product.price.toFixed(2)}</p>

                     {/* Distance Badge */}
                     {distanceStr && (
                        <div style={{display: 'inline-block', backgroundColor: '#e9f5ff', color: '#007bff', fontSize: '0.8em', padding: '3px 8px', borderRadius: '10px', marginBottom: '5px', fontWeight: 'bold'}}>
                             📍 {distanceStr}
                        </div>
                    )}

                    <div style={{margin: '5px 0', color: '#777', fontSize: '0.85em'}}>
                       {product.averageRating ? `★ ${product.averageRating.toFixed(1)} (${product.reviewCount})` : 'No ratings yet'}
                    </div>
                    <p className="product-moq-label">MOQ: {moq} | Seller: {product.wholesalerName}</p>
                  </div>
                  {isInCart ? <div onClick={(e) => e.stopPropagation()}><CartQuantityControl product={product} /></div> :
                      <button onClick={(e) => { e.stopPropagation(); handleAddToCart(product); }} disabled={isOutOfStock} className="btn-add-to-cart">{isOutOfStock ? '🚫 Out of Stock' : `🛒 Add (Min ${moq})`}</button>
                  }
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderCartPopup = () => {
    const cartDisplayItems = getCartDisplayItems();
    let totalItems = 0; let totalPrice = 0; let hasInvalidItems = false;
    cartDisplayItems.forEach(item => { totalItems += item.quantity; totalPrice += item.subtotal; if (item.isDeleted || item.isOverstocked || item.isBelowMOQ) { hasInvalidItems = true; } });

    return (
      <div className="cart-popup-overlay" onClick={(e) => { if (e.target.classList.contains('cart-popup-overlay')) setShowCartPopup(false); }}>
        <div className="cart-popup-content">
          <button className="close-btn" onClick={() => setShowCartPopup(false)}>✖</button>
          <h3 className="section-header">🛒 Your Cart ({totalItems} items)</h3>
          {totalItems === 0 ? <p>Your cart is empty.</p> : (
            <>
              <ul className="cart-items-list">
                {cartDisplayItems.map((item, index) => (
                  <li key={item.productId + index} className="cart-item" style={{ color: item.isDeleted || item.isOverstocked || item.isBelowMOQ ? 'var(--color-danger)' : 'inherit' }}>
                    <span style={{fontWeight: 'bold'}}>
                        {item.name}
                        {item.isOverstocked && <span className="cart-item-alert">(Max: {item.availableStock})</span>}
                        {item.isBelowMOQ && <span className="cart-item-alert">(Min: {item.moq})</span>}
                        {item.isDeleted && <span className="cart-item-alert">(Unavailable)</span>}
                    </span>
                    <span className="cart-item-details">(x{item.quantity}) @ ₹ {item.price.toFixed(2)} = <span style={{ color: 'var(--color-success)', marginLeft: '5px' }}>₹ { item.subtotal.toFixed(2) }</span></span>
                  </li>
                ))}
              </ul>
              <div className="cart-total">
                <strong>Subtotal: ₹ {totalPrice.toFixed(2)}</strong>
                <button className="btn-primary" style={{ marginTop: '15px', width: '100%' }} onClick={() => { setShowCartPopup(false); setShowCheckout(true); }} disabled={totalItems === 0 || hasInvalidItems}>Proceed to Checkout</button>
                {hasInvalidItems && <p style={{ color: 'var(--color-danger)', fontSize: '0.9em', marginTop: '10px' }}>*Please resolve cart errors before proceeding.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderCheckoutPage = () => {
    const cartDisplayItems = getCartDisplayItems();
    const totalOrderPrice = cartDisplayItems.reduce((total, item) => total + item.subtotal, 0);
    const totalItems = cartDisplayItems.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <div>
            <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>Checkout 🛍️</h3>
            <div className="checkout-layout">
                <div className="checkout-items-column">
                    {cartDisplayItems.map((item, index) => (
                        <div key={item.productId + index} className="checkout-item-card">
                             <img src={item.photoBase64} alt={item.name} className="checkout-item-img" />
                            <div className="checkout-item-info">
                                <h4 style={{ margin: '0 0 5px 0', color: 'var(--color-text-dark)' }}>{item.name}</h4>
                                <p style={{ margin: 0, color: 'var(--color-secondary)', fontSize: '0.9em' }}>Price: ₹ {item.price.toFixed(2)} | Qty: {item.quantity}</p>
                                <p style={{ margin: '5px 0 0 0', fontSize: '0.85em', fontStyle: 'italic', color: 'var(--color-secondary)' }}>Seller: {item.wholesalerName}</p>
                            </div>
                            <div className="checkout-item-total">₹ {item.subtotal.toFixed(2)}</div>
                        </div>
                    ))}
                </div>
                <div className="checkout-summary-column">
                    <div className="summary-card">
                        <h4 style={{ marginTop: 0, borderBottom: '1px solid #eee', paddingBottom: '10px' }}>Order Summary</h4>
                        <div className="summary-row"><span>Total Items:</span><span>{totalItems}</span></div>
                        <div className="summary-row"><span>Subtotal:</span><span>₹ {totalOrderPrice.toFixed(2)}</span></div>
                        <div className="summary-row" style={{color: 'var(--color-success)'}}><span>Shipping:</span><span>Free</span></div>
                        <div className="summary-row summary-total"><span>Total:</span><span style={{ color: 'var(--color-primary)' }}>₹ {totalOrderPrice.toFixed(2)}</span></div>

                        {/* UPDATED BUTTON: Calls startPaymentProcess */}
                        <button
                            className="btn-primary"
                            style={{ width: '100%', marginTop: '20px', padding: '12px', fontSize: '1.1em' }}
                            onClick={startPaymentProcess}
                        >
                            Confirm Order
                        </button>

                        <button className="btn-secondary" style={{ width: '100%', marginTop: '10px' }} onClick={() => { setShowCheckout(false); setShowCartPopup(true); }}>Back to Cart</button>
                    </div>
                </div>
            </div>
        </div>
    );
  };

  // --- UPDATED: Purchase History Page ---
  const renderPurchaseHistoryPage = () => {
    if (buyerOrders.length === 0) {
        return (
            <div className="form-container">
                <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>Purchase History 🧾</h3>
                <p>No purchase history found. Start shopping!</p>
            </div>
        );
    }

    const activeOrders = [];
    const pastOrders = [];

    buyerOrders.forEach(order => {
        const statuses = Object.values(order.sellerStatuses || {});
        if (statuses.length === 0) activeOrders.push(order);
        else {
            const allDelivered = statuses.every(s => s === 'Delivered');
            if (allDelivered) pastOrders.push(order);
            else activeOrders.push(order);
        }
    });

    // --- Helper to check review status ---
    // To check if user reviewed an item, we need to look at the actual product object in `wholesalerProducts`, `retailerProducts` or `myProducts`
    // We can search the consolidated list used in `getCartDisplayItems` logic logic previously
    const allProducts = [...wholesalerProducts, ...retailerProducts, ...myProducts];
    const checkReviewed = (productId) => {
        const prod = allProducts.find(p => p.id === productId);
        if (prod && prod.reviews && prod.reviews[userId]) return true;
        return false;
    };

    return (
        <div style={{ marginTop: '20px' }}>
            <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>Purchase History 🧾</h3>

            {/* ACTIVE ORDERS SECTION */}
            <h4 className="history-section-title">🚚 Active / In Progress ({activeOrders.length})</h4>
            {activeOrders.length > 0 ? (
                <div className="order-history-list">
                {activeOrders.map((order) => (
                    <div key={order.id} className="order-card">
                        <div className="order-header order-buyer-header">
                            <span className="order-role" style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}>IN PROGRESS</span>
                            <span className="order-date">{new Date(order.timestamp).toLocaleDateString()}</span>
                        </div>
                        <div className="order-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <p><strong>Order ID:</strong> {order.id.substring(0, 10)}...</p>
                                    <p><strong>Total:</strong><span style={{ color: 'var(--color-primary)', fontWeight: 'bold', marginLeft: '5px' }}>₹ {order.totalPrice.toFixed(2)}</span></p>
                                </div>
                                <button className="btn-info" style={{ fontSize: '0.8em', padding: '5px 10px' }} onClick={() => setSelectedOrderForStatus(order)}>View Status</button>
                            </div>
                            <h5 style={{ marginTop: '10px', borderBottom: '1px solid var(--color-light-gray)', paddingBottom: '5px', color: 'var(--color-primary)' }}>Items Purchased:</h5>
                            <ul className="order-items-list">
                                {order.items.map((item, index) => (
                                    <li key={item.productId + index}>
                                        <span>{item.productName}</span>
                                        <span className="item-quantity">x{item.quantity}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                ))}
                </div>
            ) : <p style={{color: '#666', fontStyle:'italic'}}>No active orders.</p>}

            <hr style={{ margin: '40px 0', borderTop: '2px dashed #ddd' }} />

            {/* PAST ORDERS SECTION (UPDATED FOR REVIEWS) */}
            <h4 className="history-section-title">✅ Past / Delivered Orders ({pastOrders.length})</h4>
            {pastOrders.length > 0 ? (
                <div className="order-history-list">
                {pastOrders.map((order) => (
                    <div key={order.id} className="order-card">
                        <div className="order-header order-buyer-header" style={{filter: 'grayscale(0.5)', backgroundColor: '#555'}}>
                            <span className="order-role" style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}>COMPLETED</span>
                            <span className="order-date">{new Date(order.timestamp).toLocaleDateString()}</span>
                        </div>
                        <div className="order-body">
                            <div>
                                <p><strong>Order ID:</strong> {order.id.substring(0, 10)}...</p>
                                <p><strong>Total:</strong><span style={{ color: 'var(--color-primary)', fontWeight: 'bold', marginLeft: '5px' }}>₹ {order.totalPrice.toFixed(2)}</span></p>
                            </div>

                            {/* View Status REMOVED for past orders as requested */}

                            <h5 style={{ marginTop: '10px', borderBottom: '1px solid var(--color-light-gray)', paddingBottom: '5px', color: 'var(--color-primary)' }}>Items & Reviews:</h5>
                            <ul className="order-items-list">
                                {order.items.map((item, index) => {
                                    const isReviewed = checkReviewed(item.productId);
                                    return (
                                        <li key={item.productId + index} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                                            <div style={{flex: 1}}>
                                                <span>{item.productName}</span>
                                                <br/>
                                                <span className="item-quantity" style={{fontSize: '0.85em'}}>x{item.quantity}</span>
                                            </div>
                                            <div>
                                                {isReviewed ? (
                                                    <span style={{color: 'var(--color-success)', fontSize: '0.85em', fontWeight: 'bold'}}>✓ Reviewed</span>
                                                ) : (
                                                    <button
                                                        className="btn-warning"
                                                        style={{ fontSize: '0.75em', padding: '4px 8px' }}
                                                        onClick={() => handleOpenReview(item, order.id)}
                                                    >
                                                        ★ Review
                                                    </button>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </div>
                ))}
                </div>
            ) : <p style={{color: '#666', fontStyle:'italic'}}>No past orders.</p>}
        </div>
    );
  };

  const renderPendingOrdersPage = () => {
      const isSeller = currentUserType === 'wholesaler' || currentUserType === 'retailer';
      if (!isSeller) return null;
      const pendingOrders = sellerOrders.filter(o => o.status !== 'Delivered');

      return (
          <div style={{ marginTop: '20px' }}>
              <h3 className="section-header" style={{ color: 'var(--color-warning)' }}>Order Management 🚚</h3>
              {pendingOrders.length === 0 ? <p>No pending orders.</p> : (
                  <div className="order-history-list">
                      {pendingOrders.map((order) => (
                          <div key={order.id} className="order-card">
                              <div className="order-header" style={{ backgroundColor: 'var(--color-warning)', color: '#333' }}>
                                  <span>Order #{order.id.substring(0, 8)}</span>
                                  <span className="order-date">{new Date(order.timestamp).toLocaleDateString()}</span>
                              </div>
                              <div className="order-body">
                                  <div className="status-control">
                                      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Current Status:</label>
                                      <select value={order.status} onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value)} className={`status-select status-${order.status.toLowerCase()}`}>
                                          <option value="Pending">🟡 Pending</option>
                                          <option value="Confirmed">🔵 Confirmed</option>
                                          <option value="Dispatched">🟠 Dispatched</option>
                                          <option value="Delivered">🟢 Delivered (Mark Complete)</option>
                                      </select>
                                  </div>
                                  <p><strong>Buyer:</strong> {order.buyerName}</p>
                                  <p><strong>Revenue:</strong><span style={{ color: 'var(--color-success)', fontWeight: 'bold', marginLeft: '5px' }}>₹ {order.totalPrice.toFixed(2)}</span></p>
                                  <h5 style={{ marginTop: '10px', borderBottom: '1px solid var(--color-light-gray)', paddingBottom: '5px' }}>Items to Ship:</h5>
                                  <ul className="order-items-list">
                                      {order.items.map((item, index) => (
                                          <li key={item.productId + index}>
                                              <span>{item.productName}</span>
                                              <div className="item-details"><span className="item-quantity">Qty: {item.quantity}</span></div>
                                          </li>
                                      ))}
                                  </ul>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
          </div>
      );
  };

  const renderRevenueDashboard = () => {
    const isSeller = currentUserType === 'wholesaler' || currentUserType === 'retailer';
    if (!isSeller) return <div className="form-container"><h3 className="section-header" style={{ color: 'var(--color-danger)' }}>Access Denied</h3></div>;
    const completedOrders = sellerOrders.filter(o => o.status === 'Delivered');

    return (
        <div style={{ marginTop: '20px' }}>
            <h3 className="section-header" style={{ color: 'var(--color-success)' }}>Revenue Dashboard 📊</h3>
            <div className="revenue-card">
                <p style={{ margin: 0, fontSize: '1.2em', fontWeight: 'bold' }}>Total Lifetime Revenue</p>
                <h2>₹ {totalRevenue.toFixed(2)}</h2>
                <p style={{ margin: '5px 0 0 0', fontSize: '0.9em' }}>(Calculated from completed 'Delivered' orders)</p>
            </div>
            <h3 className="section-header" style={{ color: 'var(--color-secondary)' }}>Completed Sales History ({completedOrders.length})</h3>
            {completedOrders.length === 0 ? <p>No completed sales yet.</p> : (
                <div className="order-history-list">
                    {completedOrders.map((order) => (
                        <div key={order.id} className="order-card">
                            <div className="order-header order-seller-header">
                                <span className="order-role" style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}>SALE</span>
                                <span className="order-date">{new Date(order.timestamp).toLocaleDateString()}</span>
                            </div>
                            <div className="order-body">
                                <p><strong>Order ID:</strong> {order.id.substring(0, 10)}...</p>
                                <p><strong>Revenue:</strong><span style={{ color: 'var(--color-success)', fontWeight: 'bold', marginLeft: '5px' }}>₹ {order.totalPrice.toFixed(2)}</span></p>
                                <p><strong>Buyer:</strong> {order.buyerName}</p>
                                <h5 style={{ marginTop: '10px', borderBottom: '1px solid var(--color-light-gray)', paddingBottom: '5px', color: 'var(--color-success)' }}>Items Sold:</h5>
                                <ul className="order-items-list">
                                    {order.items.map((item, index) => (
                                        <li key={item.productId + index}>
                                            <span>{item.productName}</span>
                                            <div className="item-details"><span className="item-quantity">x{item.quantity}</span><span className="item-price">₹ {(item.price * item.quantity).toFixed(2)}</span></div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
  };

  const renderAccountDropdown = () => {
    const showRevenue = currentUserType === 'wholesaler' || currentUserType === 'retailer';
    const showHistory = !!currentUserType;
    if (!showHistory && !showRevenue) return null;

    return (
        <div className="account-dropdown">
            {showHistory && <button className={`dropdown-item ${activeView === 'purchase_history' ? 'active' : ''}`} onClick={() => handleNavClick('purchase_history')}>🧾 Purchase History</button>}
            {showRevenue && (
                <>
                    <button className={`dropdown-item ${activeView === 'pending_orders' ? 'active' : ''}`} onClick={() => handleNavClick('pending_orders')}>🚚 Pending Orders</button>
                    <button className={`dropdown-item ${activeView === 'revenue_dashboard' ? 'active' : ''}`} onClick={() => handleNavClick('revenue_dashboard')}>📊 Revenue Dashboard</button>
                </>
            )}
        </div>
    );
  };


  // --- Main Render Logic ---

  if (loadingUserType || loadingProducts) {
    return <div style={{ padding: '50px', textAlign: 'center' }}>Loading...</div>;
  }

  const isSeller = currentUserType === 'wholesaler' || currentUserType === 'retailer';
  const canViewPurchaseHistory = !!currentUserType;
  const totalItems = Object.values(cartItems).flatMap(Object.values).reduce((sum, item) => sum + item.quantity, 0);

  let content;
  if (showCheckout) content = renderCheckoutPage();
  else if (editingProduct) content = renderProductForm(true);
  else if (showProductForm) content = renderProductForm(false);
  else if (activeView === 'purchase_history') content = renderPurchaseHistoryPage();
  else if (activeView === 'pending_orders') content = renderPendingOrdersPage();
  else if (activeView === 'revenue_dashboard') content = renderRevenueDashboard();
  else if (activeView === 'catalog' && isSeller) content = renderMyProductsList();
  else if (activeView === 'marketplace' && currentUserType !== 'consumer') content = renderWholesalerMarketplace();
  else if (activeView === 'retailer_marketplace' && (currentUserType === 'retailer' || currentUserType === 'consumer')) content = renderRetailerMarketplace();
  else {
    if (currentUserType === 'wholesaler' || currentUserType === 'retailer') { handleNavClick('marketplace'); content = renderWholesalerMarketplace(); }
    else { handleNavClick('retailer_marketplace'); content = renderRetailerMarketplace(); }
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', margin: 0, padding: 0, backgroundColor: 'var(--color-background)', minHeight: '100vh' }}>

      <div className="header">
        <div className="header-left">
            <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Shopping Mart</span>
            <div className="nav-links-mobile">
                {isSeller && (
                    <button className={`nav-item-mobile ${activeView === 'catalog' && !editingProduct && !showProductForm && !showCheckout ? 'active' : ''}`} onClick={() => handleNavClick('catalog')} title="My Catalog">📦</button>
                )}
                {(currentUserType === 'wholesaler' || currentUserType === 'retailer' || currentUserType === 'consumer') && (
                    <div className="account-menu-container">
                        <button className={`nav-item-mobile ${((activeView === 'marketplace' || activeView === 'retailer_marketplace') && !showCheckout) || showMarketDropdown ? 'active' : ''}`} onClick={() => {
                                if (currentUserType === 'retailer') { setShowMarketDropdown(prev => !prev); setShowAccountDropdown(false); }
                                else if (currentUserType === 'wholesaler') { handleNavClick('marketplace'); }
                                else if (currentUserType === 'consumer') { handleNavClick('retailer_marketplace'); }
                            }} title="Marketplace">🏪</button>
                        {currentUserType === 'retailer' && showMarketDropdown && (
                            <div className="market-dropdown account-dropdown">
                                <button className={`dropdown-item ${activeView === 'marketplace' ? 'active' : ''}`} onClick={() => handleNavClick('marketplace')}>🏢 Wholesale Market</button>
                                <button className={`dropdown-item ${activeView === 'retailer_marketplace' ? 'active' : ''}`} onClick={() => handleNavClick('retailer_marketplace')}>🔄 Retail Market</button>
                            </div>
                        )}
                    </div>
                )}
                {(canViewPurchaseHistory || isSeller) && (
                    <div className="account-menu-container">
                        <button className={`nav-item-mobile ${showAccountDropdown ? 'active' : ''}`} onClick={() => { setShowAccountDropdown(prev => !prev); setShowMarketDropdown(false); }} title="Account">👤</button>
                        {showAccountDropdown && renderAccountDropdown()}
                    </div>
                )}
            </div>
        </div>
        <div>
          <button className="icon-btn" onClick={() => { setShowCartPopup(true); setShowCheckout(false); setShowAccountDropdown(false); setShowMarketDropdown(false); }} title="View Cart">🛒{totalItems > 0 && <span className="cart-badge">{totalItems}</span>}</button>
          <button className="icon-btn logout-icon-container" onClick={handleLogout} title="Logout"><span className="material-symbols-outlined">power_settings_new</span></button>
        </div>
      </div>

      <div className="sidebar">
        {isSeller && <div className={`nav-item ${activeView === 'catalog' && !editingProduct && !showProductForm && !showCheckout ? 'active' : ''}`} onClick={() => handleNavClick('catalog')} title="My Catalog">📦</div>}
        {currentUserType !== 'consumer' && <div className={`nav-item ${activeView === 'marketplace' && !showCheckout ? 'active' : ''}`} onClick={() => handleNavClick('marketplace')} title="Wholesaler Market">🏢</div>}
        {(currentUserType === 'retailer' || currentUserType === 'consumer') && <div className={`nav-item ${activeView === 'retailer_marketplace' && !showCheckout ? 'active' : ''}`} onClick={() => handleNavClick('retailer_marketplace')} title="Retailer Resale Market">🔄</div>}
        {canViewPurchaseHistory && <div className={`nav-item ${activeView === 'purchase_history' && !showCheckout ? 'active' : ''}`} onClick={() => handleNavClick('purchase_history')} title="Purchase History">🧾</div>}
        {isSeller && <div className={`nav-item ${activeView === 'pending_orders' && !showCheckout ? 'active' : ''}`} onClick={() => handleNavClick('pending_orders')} title="Pending Orders">🚚</div>}
        {isSeller && <div className={`nav-item ${activeView === 'revenue_dashboard' && !showCheckout ? 'active' : ''}`} onClick={() => handleNavClick('revenue_dashboard')} title="Revenue Dashboard">📊</div>}
      </div>

      <div className="main-content">
        <h2 style={{ color: 'var(--color-text-light)' }}>Welcome, {user ? user.displayName : 'User'}!</h2>
        <p style={{ color: 'var(--color-secondary)', marginBottom: '30px' }}>You are logged in as a {currentUserType}.</p>
        {content}
      </div>

      {isSeller && !editingProduct && !showProductForm && !showCheckout && activeView === 'catalog' && <button className="fab" onClick={handleAddProductClick} title="Add New Product">➕</button>}
      {showCartPopup && renderCartPopup()}
      {showLocationPopup && renderLocationPopup()}
      {selectedProduct && renderProductDetailPopup()}
      {selectedOrderForStatus && renderStatusPopup()}
      {showReviewModal && renderReviewModal()}

      <NotificationPopup />
    </div>
  );
}

export default HomePage;
