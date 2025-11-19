import React, { useState, useEffect } from 'react';
import { getAuth, signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { getDatabase, ref, get, set, onValue, remove, push, runTransaction, update } from 'firebase/database';
import { initializeApp } from "firebase/app";

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

  // --- NEW STATE for Product Details Popup ---
  const [selectedProduct, setSelectedProduct] = useState(null);

  // --- NEW STATE for Order Status Popup (Buyer) ---
  const [selectedOrderForStatus, setSelectedOrderForStatus] = useState(null);

  // --- NEW STATE for Search ---
  const [searchQuery, setSearchQuery] = useState('');

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
          // Fetch all user types once to efficiently categorize products
          const usersSnapshot = await get(ref(db, 'users'));
          usersData = usersSnapshot.val() || {};

          for (let key in productData) {
              const product = { id: key, ...productData[key] };
              const sellerId = product.wholesalerId;
              const sellerType = usersData[sellerId]?.userType; // Get the type of the seller

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
                    // If legacy data or missing, default to 'Pending'
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

    // Dependency array updated to include userId (though already there) and currentUserType (for immediate order filtering)
    return () => {
        unsubscribeProducts();
        unsubscribeCart();
        unsubscribeOrders(); // Cleanup orders listener
    };
  }, [userId, navigate, currentUserType]);

  // --- Notification Timeout Effect (UNCHANGED) ---
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000); // Notification vanishes after 3 seconds
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
    setMinOrderQuantity(''); // Reset MOQ
    setAddProductError(''); setAddProductSuccess('');
    setShowProductForm(true);
  };

  // --- NEW: General Navigation Handler (Use this for all view changes) ---
  const handleNavClick = (view) => {
      setActiveView(view);
      setShowProductForm(false);
      setEditingProduct(null);
      setShowCheckout(false);
      setSearchQuery('');
      setShowAccountDropdown(false);
      setShowMarketDropdown(false); // NEW: Close market dropdown
  };
  // --- END: General Navigation Handler ---

  // --- STATUS UPDATE HANDLER (UPDATED FOR MULTI-SELLER) ---
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
      try {
          // We update specific path: orders/{orderId}/sellerStatuses/{currentUserId}
          // This ensures we don't overwrite other sellers' statuses
          const statusRef = ref(db, `orders/${orderId}/sellerStatuses/${userId}`);
          await set(statusRef, newStatus);
          setNotification(`✅ Order status updated to **${newStatus}**`);
      } catch (error) {
          console.error("Error updating status:", error);
          setNotification("🚨 Failed to update order status.");
      }
  };


  // --- Cart Adjustment Logic (for Edit and Delete) (UNCHANGED) ---

  // Function to adjust carts for stock reduction
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
                            await set(cartItemRef, {
                                productId: productId,
                                wholesalerId: currentWholesalerId,
                                quantity: newAvailableQuantity
                            });
                        } else {
                            // If newAvailableQuantity is 0, remove the item from cart
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

  // Function to adjust carts for MOQ change (if newMOQ > oldMOQ)
  const adjustCartQuantitiesForMOQ = async (productId, newMOQ, currentWholesalerId) => {
    const cartsRef = ref(db, 'carts');
    try {
        const snapshot = await get(cartsRef);
        const allCarts = snapshot.val();
        if (!allCarts) return;

        // Get the latest product details (stock)
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

                    // If new MOQ exceeds available stock, remove item from cart
                    if (newMOQ > maxStock) {
                         await remove(cartItemRef);
                         setNotification(`📢 ${productName} removed from one or more carts because **MOQ (${newMOQ})** exceeds stock.`);
                    } else {
                        // Update cart quantity to new MOQ
                        await set(cartItemRef, {
                            productId: productId,
                            wholesalerId: currentWholesalerId,
                            quantity: newMOQ
                        });
                        setNotification(`📢 Cart quantity for ${productName} in one or more carts adjusted to meet **MOQ of ${newMOQ}**.`);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error adjusting cart quantities for MOQ:', error);
    }
  };


  // --- ADD/EDIT/DELETE Logic (UNCHANGED) ---
  const handleStartEdit = (product) => {
    setShowProductForm(false);
    setEditingProduct(product);

    setProductName(product.name);
    setProductPrice(product.price.toString());
    setProductQuantity(product.quantity.toString());

    // Initialize MOQ for editing
    setMinOrderQuantity(product.minOrderQuantity ? product.minOrderQuantity.toString() : '1');

    setProductPhoto(null);
    setAddProductError(''); setAddProductSuccess('');
    handleNavClick('catalog'); // Use the unified handler
  };

  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    setAddProductLoading(true); setAddProductError(''); setAddProductSuccess('');

    if (!productName || !productPrice || !productQuantity || !editingProduct) {
      setAddProductError('Please fill all required fields.'); setAddProductLoading(false); return;
    }

    const newQuantity = parseInt(productQuantity, 10);
    // Parse new MOQ, default to 1 if empty or invalid
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
          minOrderQuantity: newMOQ, // UPDATED
      };

      await set(productRef, updatedProductData);

      // 1. Adjust carts due to stock reduction
      if (newQuantity < oldQuantity) {
        await adjustCartQuantitiesAfterUpdate(editingProduct.id, newQuantity, userId);
      }

      // 2. Adjust carts due to MOQ increase
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

      // Parse MOQ, default to 1 if empty or invalid
      const parsedMinOrderQuantity = Math.max(1, parseInt(minOrderQuantity, 10) || 1);

      await set(newProductRef, {
        name: productName, price: parseFloat(productPrice), quantity: parseInt(productQuantity, 10),
        photoBase64: photoBase64, wholesalerId: userId, wholesalerName: user.displayName || 'Unknown Seller',
        createdAt: new Date().toISOString(),
        minOrderQuantity: parsedMinOrderQuantity, // ADDED
      });
      setAddProductSuccess(`Product "${productName}" added successfully!`);
      setShowProductForm(false);
      handleNavClick('catalog'); // Use the unified handler
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
      // 1. Remove product from the main list
      const productRef = ref(db, 'products/' + product.id);
      await remove(productRef);

      // 2. Remove product from all retailer carts
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

  // --- Cart Logic (UNCHANGED) ---

  const updateCartItem = async (product, requestedQuantity) => {
    const sellerId = product.wholesalerId;
    const productId = product.id;
    const cartItemRef = ref(db, `carts/${userId}/${sellerId}/${productId}`);

    const moq = product.minOrderQuantity || 1; // GET MOQ
    let newQuantity = Math.max(0, parseInt(requestedQuantity, 10) || 0);

    // Check all products
    const allProducts = [...wholesalerProducts, ...retailerProducts, ...myProducts];
    const marketplaceProduct = allProducts.find(p => p.id === productId);
    const availableStock = marketplaceProduct ? marketplaceProduct.quantity : 0;

    // --- 1. Stock Check (CAP) ---
    if (newQuantity > availableStock) {
        newQuantity = availableStock;
        if (availableStock === 0) {
            setNotification(`🚫 "${product.name}" is **Out of Stock**!`);
        } else {
            setNotification(`⚠️ Max quantity for "${product.name}" is **${availableStock}**.`);
        }
    }

    // --- 2. MOQ Check (Only enforce if quantity is requested above 0) ---
    if (newQuantity > 0 && newQuantity < moq) {
        // If the quantity is below MOQ, correct it to MOQ (if possible within stock)
        if (moq <= availableStock) {
            newQuantity = moq;
            setNotification(`⚠️ Quantity corrected to **MOQ of ${moq}** for ${product.name}.`);
        } else {
            // If MOQ itself is higher than stock, the product cannot be purchased
            newQuantity = 0;
            setNotification(`🚫 ${product.name} cannot meet minimum order quantity of **${moq}** (Out of stock).`);
        }
    }

    try {
        if (newQuantity === 0) {
            await remove(cartItemRef);
            if (requestedQuantity !== 0) { // Only show remove notification if user didn't explicitly request 0
                 setNotification(`🗑️ Removed ${product.name} from cart.`);
            }
        } else {
            await set(cartItemRef, {
                productId: productId,
                wholesalerId: sellerId,
                quantity: newQuantity,
            });
            // Show a success notification only if a correction happened OR if it was a successful add
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
    // const moq = product.minOrderQuantity || 1; // Unused here, kept for completeness

    let requestedQuantity;

    if (change === -1 && currentQuantity <= (product.minOrderQuantity || 1) && currentQuantity > 0) {
        // NEW LOGIC: If decreasing and we are at or below MOQ, set requestedQuantity to 0 (removal).
        requestedQuantity = 0;
    } else {
        // Standard increment or decrement when above MOQ
        requestedQuantity = currentQuantity + change;
    }

    updateCartItem(product, requestedQuantity);
  };

  const handleAddToCart = (product) => {
      const moq = product.minOrderQuantity || 1;
      const sellerId = product.wholesalerId;
      const productId = product.id;
      const currentQuantity = cartItems[sellerId]?.[productId]?.quantity || 0;

      // If the product is not in the cart, add the MOQ. If it is in the cart, add 1.
      const requestedQuantity = currentQuantity === 0 ? moq : currentQuantity + 1;

      updateCartItem(product, requestedQuantity);
  };

  // --- Order Placement Logic (UPDATED FOR MULTI-SELLER STATUS) ---

  // Utility function to get flattened, current cart items for display/checkout
  const getCartDisplayItems = () => {
    // 1. Create a consolidated map of all currently available products
    const allAvailableProducts = [...wholesalerProducts, ...retailerProducts, ...myProducts];
    const allAvailableProductsMap = allAvailableProducts.reduce((acc, product) => {
        acc[product.id] = product;
        return acc;
    }, {});


    // 2. Flatten and process cart items
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
                // Re-check validity based on the latest stock data
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

  const handlePlaceOrder = async () => {
    const items = getCartDisplayItems();

    // Check for invalid items (deleted, overstocked, or below MOQ)
    const invalidItems = items.filter(item => item.isDeleted || item.isOverstocked || item.isBelowMOQ);

    if (invalidItems.length > 0) {
        setNotification('🚨 Cannot place order: One or more items in your cart are invalid (e.g., deleted, out of stock, or below MOQ). Please correct your cart.');
        setShowCheckout(false);
        setShowCartPopup(true); // Open cart popup to show issues
        return;
    }

    if (items.length === 0) {
        setNotification('🚨 Your cart is empty. Cannot place an order.');
        setShowCheckout(false);
        return;
    }

    const totalOrderPrice = items.reduce((total, item) => total + item.subtotal, 0);

    // NEW: Create Status Map for each seller involved
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
        sellerStatuses: sellerStatuses, // NEW: separate status for each seller
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
        // STEP 1: Deduct Stock Atomically using Transactions
        const stockDeductionPromises = items.map(item => {
            const productRef = ref(db, `products/${item.productId}`);

            // Use runTransaction for atomic stock deduction
            return runTransaction(productRef, (currentData) => {
                if (currentData) {
                    const availableStock = currentData.quantity;
                    const purchaseQuantity = item.quantity;

                    if (availableStock < purchaseQuantity) {
                        // Stock insufficient, abort transaction
                        console.warn(`Transaction aborted for product ${item.productId}. Requested: ${purchaseQuantity}, Available: ${availableStock}`);
                        return;
                    }

                    // Deduct stock
                    currentData.quantity = availableStock - purchaseQuantity;
                    return currentData; // Commit the updated data
                } else {
                    // Product deleted during checkout, abort
                    console.warn(`Transaction aborted for product ${item.productId}. Product not found.`);
                    return;
                }
            });
        });

        // Wait for all stock deductions to complete
        const transactionResults = await Promise.all(stockDeductionPromises);

        // Check if any transaction failed (returned null/undefined result, which means abort)
        const failedTransaction = transactionResults.find(result => !result || !result.committed);

        if (failedTransaction) {
            setNotification('🚨 Order failed! Stock changed for one or more items during checkout. Please review your cart and try again.');
            setShowCheckout(false);
            return;
        }


        // STEP 2: Write the order to the /orders path (only if all stock deductions succeeded)
        const ordersRef = ref(db, 'orders');
        await push(ordersRef, orderData);

        // STEP 3: Clear the user's cart
        const cartRef = ref(db, `carts/${userId}`);
        await remove(cartRef);

        // STEP 4: Update local state/view
        setCartItems({});
        setShowCheckout(false);
        setNotification(`🎉 Order placed successfully! Total: **₹ ${totalOrderPrice.toFixed(2)}**.`);

        // Optionally navigate to a default view
        const defaultView = currentUserType === 'wholesaler' ? 'catalog' : 'marketplace';
        setActiveView(defaultView);

    } catch (error) {
        console.error('Error placing order:', error);
        setNotification('🚨 Failed to place order. Please try again.');
    }
  };


  // --- UPDATED: Inline Component for Quantity Control ---
  const CartQuantityControl = ({ product }) => {
    const sellerId = product.wholesalerId;
    const productId = product.id;
    // Get the actual value from the DB/Cart state
    const currentQuantity = cartItems[sellerId]?.[productId]?.quantity || 0;

    // Local state allows user to type any number without immediate validation
    const [inputValue, setInputValue] = useState(currentQuantity);

    // Effect: Sync local input with DB value when DB updates (e.g. from external change or post-validation correction)
    useEffect(() => {
        setInputValue(currentQuantity);
    }, [currentQuantity]);

    // Handle typing: Just update local state
    const handleInput = (e) => {
        setInputValue(e.target.value);
    };

    // Handle Submission: Check validation and update DB
    const submitChange = () => {
        let newValue = parseInt(inputValue, 10);
        if (isNaN(newValue) || newValue < 0) newValue = 0;

        // Only update if value actually changed to prevent loop
        if (newValue !== currentQuantity) {
             // Validation (MOQ, Stock) happens inside updateCartItem
             // If invalid, it clamps the value, updates DB, and the useEffect above will
             // reset the input box to the valid clamped number.
             updateCartItem(product, newValue);
        }
    };

    // Handle Enter Key
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            submitChange();
            e.target.blur(); // Remove focus
        }
    };

    return (
      <div className="quantity-control-container">
        <button
          onClick={() => handleUpdateCartQuantity(product, -1)}
          className="quantity-btn decrement"
          disabled={currentQuantity === 0}
        >
          -
        </button>
        <input
            type="number"
            value={inputValue}
            onChange={handleInput}
            onBlur={submitChange} // Validate on click away
            onKeyDown={handleKeyDown} // Validate on Enter
            min="0"
            className="quantity-input"
        />
        <button
          onClick={() => handleUpdateCartQuantity(product, 1)}
          className="quantity-btn increment"
        >
          +
        </button>
      </div>
    );
  };

  // --- Notification Popup Component (UNCHANGED) ---
  const NotificationPopup = () => {
    if (!notification) return null;

    const renderMessage = () => {
      const parts = notification.split(/(\*\*.*?\*\*)/g);
      return parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return part;
      });
    };

    return (
      <div className="notification-popup">
        {renderMessage()}
      </div>
    );
  };

  // --- Product Detail Popup (UNCHANGED) ---
  const renderProductDetailPopup = () => {
    if (!selectedProduct) return null;

    const product = selectedProduct;
    const moq = product.minOrderQuantity || 1;
    const currentQuantity = cartItems[product.wholesalerId]?.[product.id]?.quantity || 0;
    const isOutOfStock = product.quantity <= 0;
    const isInCart = currentQuantity > 0;

    return (
      <div className="product-detail-overlay" onClick={(e) => {
        // Close if clicking outside the content area
        if (e.target.classList.contains('product-detail-overlay')) {
            setSelectedProduct(null);
        }
      }}>
        <div className="product-detail-content">
          <button className="close-btn" onClick={() => setSelectedProduct(null)}>✖</button>

          <div className="detail-header">
            <h3>{product.name}</h3>
            <p className="seller-name">Seller: {product.wholesalerName}</p>
          </div>

          <div className="detail-body">
            {/* Image Section (Simple Full Image Display) */}
            <div className="detail-photo-container">
              <img
                src={product.photoBase64}
                alt={product.name}
                className="detail-photo-simple"
              />
            </div>

            {/* Details and Actions */}
            <div className="detail-info">
              <p className="detail-price">Price: <span>₹ {product.price.toFixed(2)}</span></p>
              <p>Available Stock: <span>{product.quantity} units</span></p>
              <p className="detail-moq">Minimum Order Quantity (MOQ): <span>{moq} units</span></p>

              <div className="detail-actions">
                {isOutOfStock ? (
                    <button className="btn-out-of-stock" disabled>
                      🚫 Out of Stock
                    </button>
                ) : (
                    <>
                    <p style={{ marginTop: '15px', marginBottom: '5px' }}>Adjust Quantity:</p>
                    {isInCart ? (
                        <CartQuantityControl product={product} />
                    ) : (
                        <button onClick={() => handleAddToCart(product)} className="btn-add-to-cart btn-primary">
                          🛒 Add {moq} to Cart
                        </button>
                    )}
                    </>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Status Timeline Popup (Buyer - UPDATED FOR MULTIPLE SELLERS) ---
  const renderStatusPopup = () => {
      if (!selectedOrderForStatus) return null;

      const steps = ['Pending', 'Confirmed', 'Dispatched', 'Delivered'];
      const order = selectedOrderForStatus;

      // Group items by Wholesaler ID
      const itemsBySeller = {};
      order.items.forEach(item => {
          if (!itemsBySeller[item.wholesalerId]) {
              itemsBySeller[item.wholesalerId] = {
                  name: item.wholesalerName,
                  items: []
              };
          }
          itemsBySeller[item.wholesalerId].items.push(item);
      });

      return (
          <div className="product-detail-overlay" onClick={(e) => {
              if (e.target.classList.contains('product-detail-overlay')) {
                  setSelectedOrderForStatus(null);
              }
          }}>
              <div className="product-detail-content" style={{ maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto' }}>
                  <button className="close-btn" onClick={() => setSelectedOrderForStatus(null)}>✖</button>
                  <h3 className="section-header">Order Status 📦</h3>
                  <p style={{marginBottom: '20px'}}><strong>Order ID:</strong> {order.id.substring(0,10)}...</p>

                  {/* ITERATE THROUGH EACH SELLER IN THE ORDER */}
                  {Object.entries(itemsBySeller).map(([sellerId, data], idx) => {
                      // Get status from the map. Fallback to 'Pending' if not found.
                      const status = order.sellerStatuses && order.sellerStatuses[sellerId]
                                   ? order.sellerStatuses[sellerId]
                                   : 'Pending';

                      const currentStepIndex = steps.indexOf(status);

                      return (
                        <div key={sellerId} style={{ marginBottom: '30px', borderBottom: idx < Object.keys(itemsBySeller).length - 1 ? '1px dashed #ccc' : 'none', paddingBottom: '20px' }}>
                            <h4 style={{color: 'var(--color-primary)', margin: '0 0 10px 0'}}>
                                Seller: {data.name}
                            </h4>

                            {/* Timeline for this seller */}
                            <div className="status-timeline" style={{marginBottom: '15px'}}>
                                {steps.map((step, index) => (
                                    <div key={step} className={`timeline-step ${index <= currentStepIndex ? 'active' : ''}`}>
                                        <div className="timeline-icon">
                                            {index <= currentStepIndex ? '✔️' : '⚪'}
                                        </div>
                                        <div className="timeline-label">{step}</div>
                                        {index < steps.length - 1 && <div className={`timeline-line ${index < currentStepIndex ? 'active' : ''}`}></div>}
                                    </div>
                                ))}
                            </div>

                            {/* Items from this seller */}
                            <div style={{backgroundColor: '#f9f9f9', padding: '10px', borderRadius: '8px'}}>
                                <p style={{fontSize: '0.9em', fontWeight: 'bold', marginBottom: '5px'}}>Items included:</p>
                                <ul style={{margin: 0, paddingLeft: '20px', fontSize: '0.9em', color: '#555'}}>
                                    {data.items.map((item, itemIdx) => (
                                        <li key={itemIdx}>{item.productName} (x{item.quantity})</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                      );
                  })}
              </div>
          </div>
      );
  };


  // --- Render Sections (UPDATED WITH IMPROVED FORM UI) ---

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

          {/* Product Name */}
          <div className="form-group">
            <label>Product Name</label>
            <input
                type="text"
                className="form-control"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g., Organic Almonds 500g"
                required
            />
          </div>

          {/* Grid for Numbers */}
          <div className="form-grid">
              <div className="form-group">
                <label>Price (₹)</label>
                <input
                    type="number"
                    className="form-control"
                    value={productPrice}
                    onChange={(e) => setProductPrice(e.target.value)}
                    required
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                />
              </div>
              <div className="form-group">
                <label>Stock Quantity</label>
                <input
                    type="number"
                    className="form-control"
                    value={productQuantity}
                    onChange={(e) => setProductQuantity(e.target.value)}
                    required
                    min="1"
                    step="1"
                    placeholder="Available units"
                />
              </div>
          </div>

          {/* Grid for MOQ and Photo */}
          <div className="form-grid">
              <div className="form-group">
                <label>Minimum Order Qty (MOQ)</label>
                <input
                    type="number"
                    className="form-control"
                    value={minOrderQuantity}
                    onChange={(e) => setMinOrderQuantity(e.target.value)}
                    min="1"
                    step="1"
                    placeholder="Default: 1"
                />
              </div>
              <div className="form-group">
                 <label>{isEditing ? 'Update Photo (Optional)' : 'Product Photo'}</label>
                 <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    required={!isEditing}
                    style={{ padding: '8px' }} // Slight adjustment for file input
                 />
              </div>
          </div>

          {/* Image Preview Area */}
          {(productPhoto || (isEditing && editingProduct.photoBase64)) && (
              <div className="image-preview-container">
                  <p style={{ fontSize: '0.8em', color: '#666', marginBottom: '5px' }}>Preview:</p>
                  <img
                    src={productPhoto ? URL.createObjectURL(productPhoto) : editingProduct.photoBase64}
                    alt="Preview"
                    style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', borderRadius: '8px' }}
                  />
              </div>
          )}

          {/* Action Buttons */}
          <div className="form-action-buttons" style={{ marginTop: '30px' }}>
            {isEditing ? (
                <>
                    <button type="submit" disabled={addProductLoading} className="btn-warning btn-full-width">
                        {addProductLoading ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button type="button" onClick={() => setEditingProduct(null)} className="btn-secondary btn-full-width">
                        Cancel
                    </button>
                </>
            ) : (
                <>
                    <button type="submit" disabled={addProductLoading} className="btn-primary btn-full-width">
                        {addProductLoading ? 'Processing...' : 'Save Product'}
                    </button>
                    <button type="button" onClick={() => setShowProductForm(false)} className="btn-secondary btn-full-width">
                        Cancel
                    </button>
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
              <p className="product-moq-label">MOQ: {product.minOrderQuantity || 1} units</p>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '5px', marginTop: '10px' }}>

                {/* Delete Button */}
                <button
                    onClick={() => handleDeleteProduct(product)}
                    disabled={!!editingProduct}
                    className="btn-danger btn-icon-only"
                    title="Delete Product"
                >
                    🗑️
                </button>

                {/* Edit Button */}
                <button
                    onClick={() => handleStartEdit(product)}
                    disabled={!!editingProduct}
                    className="btn-info btn-edit"
                    title="Edit Product"
                >
                  ✏️ Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderWholesalerMarketplace = () => {
    // Filter products based on search query
    const filteredProducts = wholesalerProducts.filter(product =>
        product.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div style={{ marginTop: '20px' }}>
        <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>Wholesale Marketplace ({wholesalerProducts.length})</h3>

        {/* SEARCH BAR ADDED */}
        <div style={{ marginBottom: '20px' }}>
            <input
                type="text"
                placeholder="🔍 Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: 'var(--border-radius)', border: '1px solid #ccc', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)' }}
            />
        </div>

        {filteredProducts.length === 0 ? (
          <p>{searchQuery ? 'No products match your search.' : 'No products currently listed by wholesalers.'}</p>
        ) : (
          <div className="product-grid">
            {filteredProducts.map((product) => {
              const currentQuantity = cartItems[product.wholesalerId]?.[product.id]?.quantity || 0;
              const isOutOfStock = product.quantity <= 0;
              const isInCart = currentQuantity > 0;
              const moq = product.minOrderQuantity || 1;

              return (
                <div
                  key={product.id}
                  className="product-card"
                  style={{ opacity: isOutOfStock ? 0.6 : 1, cursor: 'pointer' }}
                  onClick={() => setSelectedProduct(product)}
                >
                  <div>
                    <img src={product.photoBase64} alt={product.name} />
                    <p className="product-name">{product.name}</p>
                    <p className="product-price">Price: ₹ {product.price.toFixed(2)}</p>
                    <p className="product-moq-label">MOQ: {moq}</p>
                  </div>

                  {isInCart ? (
                      // Stop propagation so clicking the cart control doesn't open the popup
                      <div onClick={(e) => e.stopPropagation()}>
                          <CartQuantityControl product={product} />
                      </div>
                  ) : (
                      <button onClick={(e) => { e.stopPropagation(); handleAddToCart(product); }} disabled={isOutOfStock} className="btn-add-to-cart">
                        {isOutOfStock ? '🚫 Out of Stock' : `🛒 Add (Min ${moq})`}
                      </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderRetailerMarketplace = () => {
    // Filter products based on search query
    const filteredProducts = retailerProducts.filter(product =>
        product.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div style={{ marginTop: '20px' }}>
        <h3 className="section-header" style={{ color: 'var(--color-info)' }}>Retailer Marketplace ({retailerProducts.length})</h3>

        {/* SEARCH BAR ADDED */}
        <div style={{ marginBottom: '20px' }}>
            <input
                type="text"
                placeholder="🔍 Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: 'var(--border-radius)', border: '1px solid #ccc', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)' }}
            />
        </div>

        {filteredProducts.length === 0 ? (
          <p>{searchQuery ? 'No products match your search.' : 'No products currently listed by other retailers.'}</p>
        ) : (
          <div className="product-grid">
            {filteredProducts.map((product) => {
              const currentQuantity = cartItems[product.wholesalerId]?.[product.id]?.quantity || 0;
              const isOutOfStock = product.quantity <= 0;
              const isInCart = currentQuantity > 0;
              const moq = product.minOrderQuantity || 1;

              return (
                <div
                  key={product.id}
                  className="product-card"
                  style={{ opacity: isOutOfStock ? 0.6 : 1, cursor: 'pointer' }}
                  onClick={() => setSelectedProduct(product)}
                >
                  <div>
                    <img src={product.photoBase64} alt={product.name} />
                    <p className="product-name">{product.name}</p>
                    <p className="product-price">Price: ₹ {product.price.toFixed(2)}</p>
                    <p className="product-moq-label">MOQ: {moq} | Seller: {product.wholesalerName}</p>
                  </div>

                  {isInCart ? (
                      // Stop propagation so clicking the cart control doesn't open the popup
                      <div onClick={(e) => e.stopPropagation()}>
                          <CartQuantityControl product={product} />
                      </div>
                  ) : (
                      <button onClick={(e) => { e.stopPropagation(); handleAddToCart(product); }} disabled={isOutOfStock} className="btn-add-to-cart">
                        {isOutOfStock ? '🚫 Out of Stock' : `🛒 Add (Min ${moq})`}
                      </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderCartPopup = () => {
    // Get the prepared cart items for display/checkout
    const cartDisplayItems = getCartDisplayItems();

    let totalItems = 0;
    let totalPrice = 0;
    let hasInvalidItems = false;

    cartDisplayItems.forEach(item => {
        totalItems += item.quantity;
        totalPrice += item.subtotal;

        if (item.isDeleted || item.isOverstocked || item.isBelowMOQ) {
            hasInvalidItems = true;
        }
    });

    return (
      <div className="cart-popup-overlay" onClick={(e) => {
        if (e.target.classList.contains('cart-popup-overlay')) {
            setShowCartPopup(false);
        }
      }}>
        <div className="cart-popup-content">
          <button className="close-btn" onClick={() => setShowCartPopup(false)}>✖</button>
          <h3 className="section-header">🛒 Your Cart ({totalItems} items)</h3>

          {totalItems === 0 ? (
            <p>Your cart is empty.</p>
          ) : (
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
                    <span className="cart-item-details">
                        (x{item.quantity}) @ ₹ {item.price.toFixed(2)} =
                        <span style={{ color: 'var(--color-success)', marginLeft: '5px' }}>
                            ₹ { item.subtotal.toFixed(2) }
                        </span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="cart-total">
                <strong>Subtotal: ₹ {totalPrice.toFixed(2)}</strong>
                <button
                    className="btn-primary"
                    style={{ marginTop: '15px', width: '100%' }}
                    onClick={() => { // ADDED onClick handler to switch to checkout view
                        setShowCartPopup(false);
                        setShowCheckout(true);
                    }}
                    disabled={totalItems === 0 || hasInvalidItems} // Disable if empty or invalid
                >
                    Proceed to Checkout
                </button>
                {hasInvalidItems && (
                    <p style={{ color: 'var(--color-danger)', fontSize: '0.9em', marginTop: '10px' }}>
                        *Please resolve cart errors before proceeding.
                    </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // --- Checkout Page Render (UPDATED UI) ---
  const renderCheckoutPage = () => {
    const cartDisplayItems = getCartDisplayItems();
    const totalOrderPrice = cartDisplayItems.reduce((total, item) => total + item.subtotal, 0);
    const totalItems = cartDisplayItems.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <div>
            <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>
                Checkout 🛍️
            </h3>

            {/* NEW: Split Layout Container */}
            <div className="checkout-layout">

                {/* Left Column: Item List with Images */}
                <div className="checkout-items-column">
                    {cartDisplayItems.map((item, index) => (
                        <div key={item.productId + index} className="checkout-item-card">
                             {/* Thumbnail Image */}
                             <img
                                src={item.photoBase64}
                                alt={item.name}
                                className="checkout-item-img"
                            />

                            {/* Item Details */}
                            <div className="checkout-item-info">
                                <h4 style={{ margin: '0 0 5px 0', color: 'var(--color-text-dark)' }}>{item.name}</h4>
                                <p style={{ margin: 0, color: 'var(--color-secondary)', fontSize: '0.9em' }}>
                                    Price: ₹ {item.price.toFixed(2)} | Qty: {item.quantity}
                                </p>
                                <p style={{ margin: '5px 0 0 0', fontSize: '0.85em', fontStyle: 'italic', color: 'var(--color-secondary)' }}>
                                    Seller: {item.wholesalerName}
                                </p>
                            </div>

                            {/* Subtotal */}
                            <div className="checkout-item-total">
                                ₹ {item.subtotal.toFixed(2)}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Right Column: Order Summary (Sticky) */}
                <div className="checkout-summary-column">
                    <div className="summary-card">
                        <h4 style={{ marginTop: 0, borderBottom: '1px solid #eee', paddingBottom: '10px' }}>Order Summary</h4>

                        <div className="summary-row">
                            <span>Total Items:</span>
                            <span>{totalItems}</span>
                        </div>
                        <div className="summary-row">
                            <span>Subtotal:</span>
                            <span>₹ {totalOrderPrice.toFixed(2)}</span>
                        </div>
                        <div className="summary-row" style={{color: 'var(--color-success)'}}>
                            <span>Shipping:</span>
                            <span>Free</span>
                        </div>

                        <div className="summary-row summary-total">
                            <span>Total:</span>
                            <span style={{ color: 'var(--color-primary)' }}>₹ {totalOrderPrice.toFixed(2)}</span>
                        </div>

                        <button
                            className="btn-primary"
                            style={{ width: '100%', marginTop: '20px', padding: '12px', fontSize: '1.1em' }}
                            onClick={handlePlaceOrder}
                        >
                            Confirm Order
                        </button>
                        <button
                            className="btn-secondary"
                            style={{ width: '100%', marginTop: '10px' }}
                            onClick={() => { setShowCheckout(false); setShowCartPopup(true); }}
                        >
                            Back to Cart
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
  };

  // --- NEW: Purchase History Page Render (Buyer's Orders) ---
  const renderPurchaseHistoryPage = () => {
    if (buyerOrders.length === 0) {
        return (
            <div className="form-container">
                <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>
                    Purchase History 🧾
                </h3>
                <p>No purchase history found. Start shopping!</p>
            </div>
        );
    }

    // SPLIT LOGIC: Separate Active from Past orders
    // Note: With multi-seller status, "Active" means ANY seller has not yet delivered.
    // For simplicity, if ALL sellers delivered, it's past. Otherwise active.

    const activeOrders = [];
    const pastOrders = [];

    buyerOrders.forEach(order => {
        const statuses = Object.values(order.sellerStatuses || {});
        // If statuses is empty (legacy), check order.status (legacy). If that's missing, assume active.
        if (statuses.length === 0) {
            activeOrders.push(order);
        } else {
            // If ALL statuses are 'Delivered', it's past.
            const allDelivered = statuses.every(s => s === 'Delivered');
            if (allDelivered) pastOrders.push(order);
            else activeOrders.push(order);
        }
    });


    const renderOrderList = (orders) => (
        <div className="order-history-list">
            {orders.map((order) => (
                <div key={order.id} className="order-card">
                    <div className="order-header order-buyer-header" style={pastOrders.includes(order) ? {filter: 'grayscale(0.5)', backgroundColor: '#555'} : {}}>
                        <span className="order-role" style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}>
                            {pastOrders.includes(order) ? 'COMPLETED' : 'IN PROGRESS'}
                        </span>
                        <span className="order-date">
                            {new Date(order.timestamp).toLocaleDateString()}
                        </span>
                    </div>
                    <div className="order-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <p><strong>Order ID:</strong> {order.id.substring(0, 10)}...</p>
                                <p>
                                    <strong>Total Cost:</strong>
                                    <span style={{ color: 'var(--color-primary)', fontWeight: 'bold', marginLeft: '5px' }}>
                                        ₹ {order.totalPrice.toFixed(2)}
                                    </span>
                                </p>
                            </div>
                            <button
                                className="btn-info"
                                style={{ fontSize: '0.8em', padding: '5px 10px' }}
                                onClick={() => setSelectedOrderForStatus(order)}
                            >
                                View Status
                            </button>
                        </div>

                        <h5 style={{ marginTop: '10px', borderBottom: '1px solid var(--color-light-gray)', paddingBottom: '5px', color: 'var(--color-primary)' }}>Items Purchased:</h5>
                        <ul className="order-items-list">
                            {order.items.slice(0, 3).map((item, index) => (
                                <li key={item.productId + index}>
                                    <span>{item.productName}</span>
                                    <div className="item-details">
                                        <span className="item-quantity">x{item.quantity}</span>
                                    </div>
                                </li>
                            ))}
                            {order.items.length > 3 && <li style={{fontStyle: 'italic', color: '#888'}}>... and {order.items.length - 3} more</li>}
                        </ul>
                    </div>
                </div>
            ))}
        </div>
    );

    return (
        <div style={{ marginTop: '20px' }}>
            <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>
                Purchase History 🧾
            </h3>

            {/* ACTIVE ORDERS SECTION */}
            <h4 className="history-section-title">🚚 Active / In Progress ({activeOrders.length})</h4>
            {activeOrders.length > 0 ? renderOrderList(activeOrders) : <p style={{color: '#666', fontStyle:'italic'}}>No active orders.</p>}

            {/* DIVIDER */}
            <hr style={{ margin: '40px 0', borderTop: '2px dashed #ddd' }} />

            {/* PAST ORDERS SECTION */}
            <h4 className="history-section-title">✅ Past / Delivered Orders ({pastOrders.length})</h4>
            {pastOrders.length > 0 ? renderOrderList(pastOrders) : <p style={{color: '#666', fontStyle:'italic'}}>No past orders.</p>}

        </div>
    );
  };

  // --- NEW: Pending Orders Page (Seller Side) ---
  const renderPendingOrdersPage = () => {
      const isSeller = currentUserType === 'wholesaler' || currentUserType === 'retailer';
      if (!isSeller) return null;

      // FILTER LOGIC: Only show orders where THIS seller's status is NOT Delivered
      // The status property in sellerOrders was already filtered/set in useEffect
      const pendingOrders = sellerOrders.filter(o => o.status !== 'Delivered');

      return (
          <div style={{ marginTop: '20px' }}>
              <h3 className="section-header" style={{ color: 'var(--color-warning)' }}>
                  Order Management 🚚
              </h3>

              {pendingOrders.length === 0 ? (
                  <p>No pending orders to fulfill! (Completed orders can be found in the Revenue Dashboard)</p>
              ) : (
                  <div className="order-history-list">
                      {pendingOrders.map((order) => (
                          <div key={order.id} className="order-card">
                              <div className="order-header" style={{ backgroundColor: 'var(--color-warning)', color: '#333' }}>
                                  <span>Order #{order.id.substring(0, 8)}</span>
                                  <span className="order-date">
                                      {new Date(order.timestamp).toLocaleDateString()}
                                  </span>
                              </div>
                              <div className="order-body">
                                  <div className="status-control">
                                      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Current Status:</label>
                                      <select
                                        value={order.status} // Uses specific seller status
                                        onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value)}
                                        className={`status-select status-${order.status.toLowerCase()}`}
                                      >
                                          <option value="Pending">🟡 Pending</option>
                                          <option value="Confirmed">🔵 Confirmed</option>
                                          <option value="Dispatched">🟠 Dispatched</option>
                                          <option value="Delivered">🟢 Delivered (Mark Complete)</option>
                                      </select>
                                  </div>

                                  <p><strong>Buyer:</strong> {order.buyerName}</p>
                                  <p>
                                      <strong>Your Revenue:</strong>
                                      <span style={{ color: 'var(--color-success)', fontWeight: 'bold', marginLeft: '5px' }}>
                                          ₹ {order.totalPrice.toFixed(2)}
                                      </span>
                                  </p>

                                  <h5 style={{ marginTop: '10px', borderBottom: '1px solid var(--color-light-gray)', paddingBottom: '5px' }}>Items to Ship:</h5>
                                  <ul className="order-items-list">
                                      {order.items.map((item, index) => (
                                          <li key={item.productId + index}>
                                              <span>{item.productName}</span>
                                              <div className="item-details">
                                                  <span className="item-quantity">Qty: {item.quantity}</span>
                                              </div>
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


  // --- NEW: Revenue Dashboard Page Render (Seller's Orders and Total Revenue) ---
  const renderRevenueDashboard = () => {
    const isSeller = currentUserType === 'wholesaler' || currentUserType === 'retailer';

    if (!isSeller) {
        return (
            <div className="form-container">
                <h3 className="section-header" style={{ color: 'var(--color-danger)' }}>
                    Access Denied
                </h3>
                <p>Only Wholesalers and Retailers can access the Revenue Dashboard.</p>
            </div>
        );
    }

    // Filter to show completed orders in the history list
    // The status property in sellerOrders was already filtered/set in useEffect to be THIS seller's status
    const completedOrders = sellerOrders.filter(o => o.status === 'Delivered');

    return (
        <div style={{ marginTop: '20px' }}>
            <h3 className="section-header" style={{ color: 'var(--color-success)' }}>
                Revenue Dashboard 📊
            </h3>

            {/* Total Revenue Card */}
            <div className="revenue-card">
                <p style={{ margin: 0, fontSize: '1.2em', fontWeight: 'bold' }}>Total Lifetime Revenue</p>
                <h2>₹ {totalRevenue.toFixed(2)}</h2>
                <p style={{ margin: '5px 0 0 0', fontSize: '0.9em' }}>
                    (Calculated from completed 'Delivered' orders only)
                </p>
            </div>

            <h3 className="section-header" style={{ color: 'var(--color-secondary)' }}>
                Completed Sales History ({completedOrders.length})
            </h3>

            {completedOrders.length === 0 ? (
                <p>No completed sales yet. Mark orders as 'Delivered' in Pending Orders to see them here.</p>
            ) : (
                <div className="order-history-list">
                    {completedOrders.map((order) => (
                        <div key={order.id} className="order-card">
                            <div className="order-header order-seller-header">
                                <span className="order-role" style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}>
                                    SALE
                                </span>
                                <span className="order-date">
                                    {new Date(order.timestamp).toLocaleDateString()}
                                </span>
                            </div>
                            <div className="order-body">
                                <p><strong>Order ID:</strong> {order.id.substring(0, 10)}...</p>
                                <p>
                                    <strong>Revenue:</strong>
                                    <span style={{ color: 'var(--color-success)', fontWeight: 'bold', marginLeft: '5px' }}>
                                        ₹ {order.totalPrice.toFixed(2)}
                                    </span>
                                </p>
                                <p><strong>Buyer:</strong> {order.buyerName}</p>

                                <h5 style={{ marginTop: '10px', borderBottom: '1px solid var(--color-light-gray)', paddingBottom: '5px', color: 'var(--color-success)' }}>Your Items Sold:</h5>
                                <ul className="order-items-list">
                                    {order.items.map((item, index) => (
                                        <li key={item.productId + index}>
                                            <span>{item.productName}</span>
                                            <div className="item-details">
                                                <span className="item-quantity">x{item.quantity}</span>
                                                <span className="item-price">
                                                    ₹ {(item.price * item.quantity).toFixed(2)}
                                                </span>
                                            </div>
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

  // --- NEW: Account Dropdown Render Function (Mobile Only) ---
  const renderAccountDropdown = () => {
    // Determine which links to show
    const showRevenue = currentUserType === 'wholesaler' || currentUserType === 'retailer';
    const showHistory = !!currentUserType; // All logged-in users can view history

    if (!showHistory && !showRevenue) return null;

    return (
        <div className="account-dropdown">
            {showHistory && (
                <button
                    className={`dropdown-item ${activeView === 'purchase_history' ? 'active' : ''}`}
                    onClick={() => handleNavClick('purchase_history')}
                >
                    🧾 Purchase History
                </button>
            )}
            {showRevenue && (
                <>
                    <button
                        className={`dropdown-item ${activeView === 'pending_orders' ? 'active' : ''}`}
                        onClick={() => handleNavClick('pending_orders')}
                    >
                        🚚 Pending Orders
                    </button>
                    <button
                        className={`dropdown-item ${activeView === 'revenue_dashboard' ? 'active' : ''}`}
                        onClick={() => handleNavClick('revenue_dashboard')}
                    >
                        📊 Revenue Dashboard
                    </button>
                </>
            )}
        </div>
    );
  };


  // --- Main Render Logic (UPDATED) ---

  if (loadingUserType || loadingProducts) {
    return <div style={{ padding: '50px', textAlign: 'center' }}>Loading...</div>;
  }

  // All logged-in users are 'buyers' in terms of purchase history.
  const isSeller = currentUserType === 'wholesaler' || currentUserType === 'retailer';
  const canViewPurchaseHistory = !!currentUserType; // All logged-in users can view history
  const totalItems = Object.values(cartItems).flatMap(Object.values).reduce((sum, item) => sum + item.quantity, 0);

  let content;
  if (showCheckout) {
    content = renderCheckoutPage();
  } else if (editingProduct) {
    content = renderProductForm(true);
  } else if (showProductForm) {
    content = renderProductForm(false);
  } else if (activeView === 'purchase_history') {
    content = renderPurchaseHistoryPage();
  } else if (activeView === 'pending_orders') {
    content = renderPendingOrdersPage();
  } else if (activeView === 'revenue_dashboard') {
    content = renderRevenueDashboard();
  } else if (activeView === 'catalog' && isSeller) {
    content = renderMyProductsList();
  } else if (activeView === 'marketplace' && currentUserType !== 'consumer') {
    // Wholesaler Market visible only to Wholesaler/Retailer
    content = renderWholesalerMarketplace();
  } else if (activeView === 'retailer_marketplace' && (currentUserType === 'retailer' || currentUserType === 'consumer')) {
    // Retailer Market visible only to Retailers and Consumers
    content = renderRetailerMarketplace();
  } else {
    // Default Fallback Logic
    if (currentUserType === 'wholesaler' || currentUserType === 'retailer') {
        // Default to Wholesale Market
        handleNavClick('marketplace');
        content = renderWholesalerMarketplace();
    } else {
        // Default to Retailer Market
        handleNavClick('retailer_marketplace');
        content = renderRetailerMarketplace();
    }
  }


  return (
    <div style={{ fontFamily: 'Arial, sans-serif', margin: 0, padding: 0, backgroundColor: 'var(--color-background)', minHeight: '100vh' }}>
      {/* 1. Global Styles and CSS Variables (UPDATED WITH DROPDOWN STYLES) */}
      <style>{`
        /* --- Material Icons Link --- */
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=power_settings_new');

        /* --- CSS Variables (Updated to match login.js palette and introduce glass effect) --- */
        :root {
            --color-primary: #007bff;
            --color-secondary: #6c757d;
            --color-success: #28a745;
            --color-danger: #dc3545;
            --color-warning: #ffc107;
            --color-warning-light: #fff3cd;
            --color-info: #17a2b8;
            --color-background: #eef4f8; /* Updated: Soft background to match glassmorphism scheme */
            --color-header: #343a40; /* Dark contrast header */
            --color-text-light: #333;
            --color-text-dark: #000;
            --color-light-gray: #e9ecef;
            --color-bg-card: rgba(255, 255, 255, 0.85); /* Translucent white for glass effect */
            --transition-speed: 0.3s;

            /* NEW UI HINTS from login.js style */
            --border-radius: 12px; /* Slightly larger radius for the glass look */
            --box-shadow-glass: 0 4px 30px rgba(0, 0, 0, 0.1);
        }

        /* --- Global Icon/Layout Styles --- */
        .material-symbols-outlined {
          font-family: 'Material Symbols Outlined';
          font-variation-settings:
            'FILL' 0,
            'wght' 400,
            'GRAD' 0,
            'opsz' 24;
          font-size: 1.5rem;
        }

        /* Consistent Section Header Styling */
        .section-header {
            border-bottom: 2px solid var(--color-light-gray);
            padding-bottom: 10px;
            margin-bottom: 20px;
            font-size: 1.5rem;
            font-weight: 600;
        }


        /*
         * HEADER (Top Navbar) - MODIFIED: Now visible on desktop
         */
        .header {
            background-color: var(--color-header);
            color: white;
            padding: 10px 20px;
            display: flex; /* MODIFIED: Change from 'none' to 'flex' */
            justify-content: space-between;
            align-items: center;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            height: 50px;
        }
        .nav-links-mobile {
            display: none; /* MODIFIED: Hide mobile links on desktop */
            gap: 5px;
            padding-left: 5px;
        }
        .header-left { display: flex; align-items: center; }

        .icon-btn { background: none; border: none; color: white; cursor: pointer; font-size: 1.5rem; margin: 0 5px; padding: 5px; position: relative; transition: color var(--transition-speed); }
        .icon-btn:hover { color: var(--color-warning); }

        .cart-badge { font-size: 0.6em; position: absolute; top: 5px; right: 15px; background-color: var(--color-danger); color: white; border-radius: 50%; padding: 2px 5px; }

        /* * SIDEBAR (Desktop View)
         */
        .sidebar {
            position: fixed;
            top: 50px; /* Starts 50px down (below the header) */
            left: 0;
            width: 60px;
            height: calc(100% - 50px); /* Adjust height to fill below header */
            background-color: var(--color-background);
            padding-top: 25px; /* MODIFIED: Increased from 10px to 25px to move buttons down */
            border-right: 1px solid #ddd;
            z-index: 999;
        }

        /* Nav Item Styles */
        .nav-item { margin-bottom: 20px; text-align: center; cursor: pointer; padding: 10px 0; font-size: 1.5rem; transition: background-color var(--transition-speed), color var(--transition-speed); }

        /* Logout Button Specific Style (Improved) */
        .logout-icon-container {
            color: var(--color-danger);
            top: 5px;
            padding: 10px 0;
        }
        .logout-icon-container .material-symbols-outlined {
            font-size: 1.8rem;
            line-height: 1.5rem;
            transition: color var(--transition-speed);
        }
        .logout-icon-container:hover {
            color: white;
        }
        .logout-icon-container:hover .material-symbols-outlined {
            color: white;
        }

        /* Update standard nav item hover */
        .nav-item:hover:not(.logout-icon-container), .nav-item.active {
            background-color: var(--color-light-gray);
            color: var(--color-primary);
        }

        /* --- Mobile Navigation Links --- */
        .nav-item-mobile {
            background: none;
            border: none;
            color: var(--color-warning); /* MODIFIED: Changed from 'white' for better visibility against the dark header */
            cursor: pointer;
            font-size: 1.2rem;
            padding: 8px;
            border-radius: 8px;
            transition: background-color var(--transition-speed);
            display: flex; align-items: center; justify-content: center;
        }
        .nav-item-mobile.active {
            background-color: rgba(255, 255, 255, 0.2); /* Highlight active link */
        }

        /* --- NEW: Dropdown Styles for Mobile Header --- */
        .account-menu-container {
            position: relative; /* Container for the button and dropdown */
        }

        .account-dropdown {
            position: absolute;
            top: 45px; /* Position below the button */
            right: 0; /* Align right side of dropdown with button right side */
            min-width: 200px;
            background-color: var(--color-bg-card); /* Use translucent card background */
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow-glass);
            z-index: 1050; /* Above header elements but below popups */
            padding: 10px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }

        /* NEW: Market Dropdown Positioning */
        .market-dropdown {
             left: 0; /* Align left side with button left side */
             right: unset;
        }


        .dropdown-item {
            background: none;
            border: none;
            text-align: left;
            padding: 10px 15px;
            margin: 5px 0;
            cursor: pointer;
            font-size: 0.95em;
            font-weight: 500;
            color: var(--color-text-light);
            border-radius: 8px;
            transition: background-color var(--transition-speed);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .dropdown-item:hover {
            background-color: var(--color-light-gray);
        }
        .dropdown-item.active {
            background-color: var(--color-primary);
            color: white;
        }


        /* * MAIN CONTENT (Desktop View)
         */
        .main-content {
            margin-top: 50px; /* Added 50px margin-top for the fixed header */
            margin-left: 60px;
            padding: 20px;
            max-width: 1000px;
            margin-right: auto;
            margin-left: auto;
            background-color: var(--color-background);
            min-height: calc(100vh - 50px); /* Adjust min-height */
        }

        /* UPDATED GRID: use auto-fill instead of auto-fit to prevent huge single cards */
        .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }

        /* Glass Effect for Product Card - UPDATED FOR FIXED SIZE */
        .product-card {
            background-color: var(--color-bg-card);
            border: 1px solid rgba(255, 255, 255, 0.3); /* Light border for glass effect */
            border-radius: var(--border-radius);
            padding: 15px; text-align: center;
            box-shadow: var(--box-shadow-glass);
            transition: transform var(--transition-speed), box-shadow var(--transition-speed);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);

            /* FIX: Fixed height and Flexbox for alignment */
            height: 340px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        .product-card:hover { transform: translateY(-5px); box-shadow: 0 8px 20px rgba(0,0,0,0.15); }
        .product-card img { width: 100%; height: 140px; object-fit: cover; border-radius: calc(var(--border-radius) - 2px); margin-bottom: 10px; }

        /* FIX: Limit text lines for product name */
        .product-name {
            font-weight: bold; margin: 0 0 5px 0; font-size: 1.1em; color: var(--color-text-light);
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            height: 2.4em; /* Fixed height for name area */
        }

        .product-price { color: var(--color-success); margin: 0 0 10px 0; font-weight: 600; }
        .product-moq-label { font-size: 0.8em; color: var(--color-secondary); font-weight: bold; }


        /* Button Styling (Unified with Shadows) */
        button {
            padding: 10px 15px;
            border: none;
            border-radius: var(--border-radius);
            cursor: pointer;
            font-weight: 600; /* Bolder text for better contrast */
            transition: all var(--transition-speed);
            text-align: center;
        }

        button:disabled { opacity: 0.6; cursor: not-allowed; }
        button:hover:not(:disabled) { filter: brightness(1.1); }

        /* Color Variants with Shadows */
        .btn-primary { background-color: var(--color-primary); color: white; box-shadow: 0 4px 6px rgba(0, 123, 255, 0.3); }
        .btn-warning { background-color: var(--color-warning); color: var(--color-text-dark); box-shadow: 0 4px 6px rgba(255, 193, 7, 0.3); }
        .btn-danger { background-color: var(--color-danger); color: white; box-shadow: 0 4px 6px rgba(220, 53, 69, 0.3); }
        .btn-info { background-color: var(--color-info); color: white; }
        .btn-secondary { background-color: var(--color-secondary); color: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }

        /* Contextual Buttons */
        .btn-add-to-cart { width: 100%; background-color: var(--color-warning); color: var(--color-text-dark); box-shadow: 0 4px 6px rgba(255, 193, 7, 0.3); }

        /* Specific Catalog Buttons */
        .btn-icon-only { flex-grow: 1; padding: 8px 5px; }
        .btn-edit { flex-grow: 2; padding: 8px 5px; }

        /* Form Action Buttons */
        .btn-full-width { flex-grow: 1; width: 50%; padding: 12px 10px; margin-bottom: 0; }


        /* Quantity Control Styling */
        .quantity-control-container { display: flex; justify-content: space-between; align-items: center; width: 100%; border: 1px solid var(--color-primary); border-radius: var(--border-radius); overflow: hidden; height: 36px; }
        .quantity-btn {
            width: 15%;
            flex-basis: 20%;
            background-color: var(--color-primary);
            color: white; border: none; font-size: 1.1em;
            cursor: pointer; transition: background-color 0.2s;
            padding: 0; line-height: 34px; height: 100%; border-radius: 0;
        }
        .quantity-btn:hover:not(:disabled) { background-color: #0056b3; }
        .quantity-btn.decrement { background-color: var(--color-danger); }
        .quantity-btn.decrement:hover:not(:disabled) { background-color: #c82333; }
        .quantity-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Quantity Input Field Style */
        .quantity-input {
            width: 60%;
            flex-grow: 1;
            text-align: center;
            font-weight: bold;
            color: var(--color-primary);
            background-color: var(--color-light-gray);
            height: 100%;
            padding: 0;
            border: none;
            box-sizing: border-box;
            -moz-appearance: textfield; /* Firefox hide arrows */
            appearance: textfield;
        }
        /* Hide arrows for Chrome, Safari, Edge, Opera */
        .quantity-input::-webkit-outer-spin-button,
        .quantity-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        /* Form Styling (Glass Effect) */
        .form-container {
            background-color: var(--color-bg-card);
            padding: 30px;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow-glass);
            margin-bottom: 30px;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid var(--color-primary); /* Keep the primary/warning border hint */
        }

        /* NEW: Form Groups and Grid */
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            text-align: left;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--color-secondary);
            font-size: 0.95rem;
        }

        /* NEW: Form Inputs Styles */
        .form-control {
            width: 100%;
            padding: 12px;
            border: 1px solid #ced4da;
            border-radius: var(--border-radius);
            box-sizing: border-box;
            font-size: 1rem;
            transition: border-color 0.3s, box-shadow 0.3s;
            background-color: rgba(255, 255, 255, 0.8);
        }
        .form-control:focus {
            border-color: var(--color-primary);
            outline: none;
            box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.25);
        }

        /* NEW: Grid Layout for Form */
        .form-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }

        /* NEW: Image Preview Container */
        .image-preview-container {
            margin-top: 15px;
            padding: 10px;
            border: 2px dashed #ccc;
            border-radius: var(--border-radius);
            text-align: center;
            background-color: rgba(255,255,255,0.5);
        }

        /* Form Messages */
        .form-error { color: var(--color-danger); font-weight: bold; }
        .form-success { color: var(--color-success); font-weight: bold; }


        .form-action-buttons { display: flex; justify-content: space-between; gap: 10px; margin-top: 15px; }

        /* Floating Action Button */
        .fab {
            position: fixed; bottom: 30px; right: 20px; /* Moved to bottom right corner */
            left: unset; transform: none;
            width: 60px; height: 60px; border-radius: 50%;
            background-color: var(--color-success);
            color: white;
            font-size: 2rem; border: none;
            box-shadow: 0 6px 10px rgba(40, 167, 69, 0.4); /* Stronger success shadow */
            cursor: pointer; z-index: 100;
            display: flex; align-items: center; justify-content: center; /* UPDATED: Centering fix */
            transition: background-color var(--transition-speed);
        }
        .fab:hover { background-color: #1e7e34; }

        /* Cart Popup Styles (Glass Effect) */
        .cart-popup-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.4); display: flex; justify-content: flex-end; z-index: 2000; }
        .cart-popup-content {
            background: var(--color-bg-card);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            width: 350px; height: 100%; padding: 20px;
            box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15); /* Slightly darker shadow for sidebar */
            position: relative; overflow-y: auto;
            border-radius: 0; /* No radius on the side of the screen */
        }
        .close-btn { position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-danger); }

        .cart-items-list { list-style: none; padding: 0; margin: 10px 0; }
        .cart-item { display: flex; flex-direction: column; align-items: flex-start; padding: 10px 0; border-bottom: 1px dashed var(--color-light-gray); font-size: 1em; }
        .cart-item:last-child { border-bottom: none; }
        .cart-item-details { display: flex; justify-content: space-between; width: 100%; margin-top: 5px; }
        .cart-item-alert { font-size:0.8em; color:var(--color-danger); margin-left: 10px; }

        .cart-total { margin-top: 20px; padding-top: 10px; border-top: 2px solid var(--color-header); text-align: right; }

        /* Notification Popup Style (Bottom Left Corner) */
        .notification-popup {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background-color: var(--color-header);
            color: white;
            padding: 15px 20px;
            border-radius: var(--border-radius);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            z-index: 3000;
            opacity: 1;
            transition: opacity 0.3s ease-in-out;
            max-width: 300px;
            font-size: 0.9em;
            font-weight: 500;
        }
        .notification-popup strong {
            color: var(--color-warning);
            font-weight: bold;
        }

        /* --- Product Detail Popup Styles (Glass Effect) --- */
        .product-detail-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex; justify-content: center; align-items: center;
            z-index: 4000;
        }
        .product-detail-content {
            background: var(--color-bg-card);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            width: 90%; max-width: 700px;
            padding: 30px;
            border-radius: var(--border-radius);
            box-shadow: 0 5px 20px rgba(0, 0, 0, 0.2);
            position: relative;
        }
        .product-detail-content .close-btn {
            top: 15px; right: 15px;
            font-size: 2rem;
        }
        .detail-header { border-bottom: 2px solid var(--color-light-gray); padding-bottom: 15px; margin-bottom: 20px; }
        .detail-header h3 { margin: 0; font-size: 2rem; color: var(--color-primary); }
        .seller-name { color: var(--color-secondary); font-size: 1.1em; }

        .detail-body { display: flex; gap: 30px; }

        /* Image Container for simple view */
        .detail-photo-container {
            flex-basis: 45%;
            max-width: 300px;
            height: auto;
            position: relative;
            border: 1px solid #ddd;
            border-radius: var(--border-radius);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* Simple Image Styling */
        .detail-photo-simple {
            width: 100%;
            height: auto;
            object-fit: contain;
            border-radius: 0;
            box-shadow: none;
            cursor: default;
        }

        .detail-info { flex-basis: 55%; }
        .detail-info p { margin: 10px 0; font-size: 1.1em; }
        .detail-info span { font-weight: bold; color: var(--color-text-dark); margin-left: 5px; }
        .detail-price span { color: var(--color-success); font-size: 1.3em; }
        .detail-moq { font-style: italic; font-size: 1em; }

        .detail-actions { margin-top: 25px; }
        .btn-out-of-stock { width: 100%; padding: 12px; background-color: var(--color-danger); color: white; border: none; border-radius: var(--border-radius); font-weight: bold; opacity: 0.7; cursor: not-allowed; }

        /* --- NEW: Timeline Styles --- */
        .status-timeline { display: flex; justify-content: space-between; margin-top: 10px; position: relative; }
        .timeline-step { display: flex; flex-direction: column; align-items: center; position: relative; flex: 1; }
        .timeline-icon { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; z-index: 2; background: white; border-radius: 50%; }
        .timeline-label { font-size: 0.8em; margin-top: 5px; color: var(--color-secondary); font-weight: bold; }
        .timeline-line { position: absolute; top: 15px; left: 50%; width: 100%; height: 2px; background-color: #ddd; z-index: 1; }
        .timeline-step.active .timeline-label { color: var(--color-success); }
        .timeline-line.active { background-color: var(--color-success); }

        /* --- NEW: Order Status Dropdown Styles --- */
        .status-control {
            margin: 10px 0;
            padding: 10px;
            background-color: rgba(255, 255, 255, 0.4);
            border-radius: 8px;
        }
        .status-select {
            padding: 8px;
            border-radius: 5px;
            font-weight: bold;
            width: 100%;
            border: 1px solid #ccc;
        }
        .status-pending { background-color: #fff3cd; color: #856404; }
        .status-confirmed { background-color: #cce5ff; color: #004085; }
        .status-dispatched { background-color: #ffeeba; color: #856404; }
        .status-delivered { background-color: #d4edda; color: #155724; }

        /* --- NEW: History Section Styles --- */
        .history-section-title {
            color: var(--color-secondary);
            font-weight: bold;
            margin: 15px 0 10px 0;
            padding-left: 5px;
            border-left: 4px solid var(--color-primary);
            padding: 5px 10px;
            background: rgba(255,255,255,0.5);
            border-radius: 0 var(--border-radius) var(--border-radius) 0;
        }


        /* --- NEW: Order History/Revenue Styles (Improved UI) --- */
        .revenue-card {
            background-color: var(--color-success);
            color: white;
            padding: 20px;
            border-radius: var(--border-radius);
            box-shadow: 0 4px 10px rgba(40, 167, 69, 0.5);
            margin-bottom: 30px;
            text-align: center;
        }
        .revenue-card h2 {
            margin: 5px 0 0 0;
            font-size: 2.5em;
        }
        .order-history-list {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }
        .order-card {
            background-color: var(--color-bg-card);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow-glass);
            overflow: hidden;
            transition: transform 0.2s;
            backdrop-filter: blur(5px);
        }
        .order-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 15px rgba(0, 0, 0, 0.15);
        }
        .order-header {
            padding: 12px 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: bold;
            font-size: 1.1em;
            color: white;
        }
        .order-role {
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 0.8em;
        }
        .order-buyer-header { background-color: var(--color-primary); }
        .order-seller-header { background-color: var(--color-success); }

        .order-body { padding: 15px; }
        .order-body p { margin: 5px 0; font-size: 0.95em; }
        .order-items-list { list-style-type: none; padding-left: 0; margin-top: 10px; }
        .order-items-list li {
            margin-bottom: 5px;
            font-size: 0.9em;
            display: flex;
            justify-content: space-between;
            padding-bottom: 3px;
            border-bottom: 1px dotted var(--color-light-gray);
        }
        .order-items-list li:last-child { border-bottom: none; }
        .item-details { display: flex; gap: 15px; }
        .item-quantity { color: var(--color-secondary); font-style: italic; }
        .item-price { color: var(--color-text-dark); font-weight: bold; }

        /* --- NEW: Checkout Page Styles --- */
        .checkout-layout {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }
        .checkout-items-column {
            flex: 2;
            min-width: 300px;
        }
        .checkout-summary-column {
            flex: 1;
            min-width: 250px;
        }
        .checkout-item-card {
            display: flex;
            align-items: center;
            background: var(--color-bg-card);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: var(--border-radius);
            padding: 15px;
            margin-bottom: 15px;
            box-shadow: var(--box-shadow-glass);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }
        .checkout-item-img {
            width: 80px;
            height: 80px;
            object-fit: cover;
            border-radius: 8px;
            margin-right: 15px;
            border: 1px solid #eee;
        }
        .checkout-item-info {
            flex-grow: 1;
        }
        .checkout-item-total {
            font-weight: bold;
            color: var(--color-success);
            font-size: 1.1em;
            white-space: nowrap;
            margin-left: 10px;
        }

        .summary-card {
            background: var(--color-bg-card);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: var(--border-radius);
            padding: 20px;
            box-shadow: var(--box-shadow-glass);
            position: sticky;
            top: 80px; /* Below header (Adjusted to 20px buffer since header is now gone) */
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }
        .summary-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            font-size: 1rem;
        }
        .summary-total {
            border-top: 2px solid var(--color-light-gray);
            padding-top: 15px;
            margin-top: 15px;
            font-weight: bold;
            font-size: 1.2rem;
            color: var(--color-text-dark);
        }


        /* ======================================= */
        /* --- MOBILE FRIENDLY MEDIA QUERIES --- */
        /* ======================================= */
        @media (max-width: 768px) {
            /* 1. Header Navigation */
            .header {
                /* Display is flex by default now */
                height: 50px;
                padding: 5px 15px;
            }
            .sidebar { display: none; } /* Hide Sidebar */

            /* Display Mobile Nav Links */
            .nav-links-mobile {
                display: flex; /* MODIFIED: Show mobile links on small screen */
            }

            /* Style Mobile Nav Items (Icon buttons) */
            .nav-item-mobile {
                font-size: 1.2rem;
                padding: 8px;
            }

            /* Logout button in header */
            .logout-icon-container {
                margin: 0;
                padding: 0;
            }
            .logout-icon-container .material-symbols-outlined {
                color: white;
                font-size: 1.5rem;
            }
            .logout-icon-container:hover {
                background-color: transparent;
                color: var(--color-warning);
            }
            .logout-icon-container:hover .material-symbols-outlined {
                color: var(--color-warning);
            }

            /* Ensure dropdown fits within mobile viewport */
            .account-dropdown {
                min-width: 180px;
            }

            /* 2. Main Content Adjustment */
            .main-content {
                margin-top: 50px; /* Added 50px margin-top back for the visible header */
                margin-left: 0;
                padding: 15px;
            }

            /* 3. Product Grid */
            .product-grid {
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); /* 2 columns is better than 1 */
                gap: 15px;
            }
            .product-card img {
                 height: 120px;
            }

            /* NEW: Mobile adjustment for form grid */
            .form-grid {
                grid-template-columns: 1fr;
                gap: 10px;
            }

            /* 4. Product Detail Popup */
            .product-detail-content {
                width: 100%;
                /* FIX: Use max-height based on viewport for scrollability (100vh - 50px header - 20px margin) */
                max-height: calc(100vh - 40px);
                height: auto;
                border-radius: 0;
                padding: 20px;
                overflow-y: auto;
            }
            .product-detail-overlay {
                align-items: flex-start; /* Start from the top */
                justify-content: center;
                /* REMOVED: padding-top: 50px; */
            }
            .detail-body { flex-direction: column; }
            .detail-photo-container { max-width: 100%; margin-bottom: 20px; }
            .detail-header h3 { font-size: 1.5rem; }

            /* FIX 1: Ensure detail-info takes full width when body is column */
            .detail-info { flex-basis: 100%; }

            /* FIX 2: Ensure quantity control doesn't get boxed in */
            .quantity-control-container { width: 100%; max-width: none; }


            /* 5. Cart Popup */
            .cart-popup-content {
                width: 100%;
            }

            /* 6. FAB Position */
            .fab {
                bottom: 15px;
                right: 15px;
                width: 50px;
                height: 50px;
                font-size: 1.5rem;
            }

            /* 7. Notification Popup */
            .notification-popup {
                width: calc(100% - 40px);
                left: 10px;
                right: 10px;
                bottom: 10px;
                max-width: none;
                text-align: center;
            }

            /* 8. Order List */
            .order-history-list { grid-template-columns: 1fr; }
            .revenue-card { font-size: 0.9em; }
            .revenue-card h2 { font-size: 2em; }

             /* 9. Checkout Summary sticky behavior is less useful on mobile */
            .checkout-summary-column .summary-card {
                position: static;
                top: auto;
            }

        }
      `}</style>


      {/* 2. Fixed Header (UPDATED) */}
      <div className="header">
        <div className="header-left">
            <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Shopping Mart</span>

            {/* Mobile Navigation Links (Hidden on Desktop, Visible on Mobile) */}
            <div className="nav-links-mobile">
                {/* Catalog Icon (Visible only to Wholesaler/Retailer) */}
                {isSeller && (
                    <button
                        className={`nav-item-mobile ${activeView === 'catalog' && !editingProduct && !showProductForm && !showCheckout ? 'active' : ''}`}
                        onClick={() => handleNavClick('catalog')}
                        title="My Catalog"
                    >
                        📦
                    </button>
                )}

                {/* NEW: Marketplace Button/Dropdown (Visible to Wholesaler, Retailer, Consumer) */}
                {(currentUserType === 'wholesaler' || currentUserType === 'retailer' || currentUserType === 'consumer') && (
                    <div className="account-menu-container"> {/* Reusing the container class for positioning */}
                        <button
                            className={`nav-item-mobile ${((activeView === 'marketplace' || activeView === 'retailer_marketplace') && !showCheckout) || showMarketDropdown ? 'active' : ''}`}
                            onClick={() => {
                                // Retailer: Toggle dropdown
                                if (currentUserType === 'retailer') {
                                    setShowMarketDropdown(prev => !prev);
                                    setShowAccountDropdown(false); // Close other dropdown
                                }
                                // Wholesaler: Go straight to Wholesale Market
                                else if (currentUserType === 'wholesaler') {
                                    handleNavClick('marketplace');
                                }
                                // Consumer: Go straight to Retailer Market
                                else if (currentUserType === 'consumer') {
                                    handleNavClick('retailer_marketplace');
                                }
                            }}
                            title="Marketplace"
                        >
                            🏪
                        </button>

                        {/* Marketplace Dropdown (Only for Retailers) */}
                        {currentUserType === 'retailer' && showMarketDropdown && (
                            <div className="market-dropdown account-dropdown"> {/* Reusing base styles */}
                                <button
                                    className={`dropdown-item ${activeView === 'marketplace' ? 'active' : ''}`}
                                    onClick={() => handleNavClick('marketplace')}
                                >
                                    🏢 Wholesale Market
                                </button>
                                <button
                                    className={`dropdown-item ${activeView === 'retailer_marketplace' ? 'active' : ''}`}
                                    onClick={() => handleNavClick('retailer_marketplace')}
                                >
                                    🔄 Retail Market
                                </button>
                            </div>
                        )}
                    </div>
                )}


                {/* NEW: ACCOUNT DROPDOWN BUTTON (Mobile Only) */}
                {(canViewPurchaseHistory || isSeller) && (
                    <div className="account-menu-container">
                        <button
                            className={`nav-item-mobile ${showAccountDropdown ? 'active' : ''}`}
                            onClick={() => { setShowAccountDropdown(prev => !prev); setShowMarketDropdown(false); }}
                            title="Account"
                        >
                            👤
                        </button>
                        {showAccountDropdown && renderAccountDropdown()}
                    </div>
                )}

            </div>
        </div>

        <div>
          {/* Cart Icon */}
          <button className="icon-btn" onClick={() => { setShowCartPopup(true); setShowCheckout(false); setShowAccountDropdown(false); setShowMarketDropdown(false); }} title="View Cart">
            🛒
            {totalItems > 0 && <span className="cart-badge">{totalItems}</span>}
          </button>
          {/* Logout (Material Symbols Outlined icon) */}
          <button className="icon-btn logout-icon-container" onClick={handleLogout} title="Logout">
              <span className="material-symbols-outlined">
                power_settings_new
              </span>
          </button>
        </div>
      </div>

      {/* 3. Sidebar Navigation (Desktop only) (MODIFIED POSITION) */}
      <div className="sidebar">
        {/* Catalog Icon (Visible only to Wholesaler/Retailer) */}
        {isSeller && (
          <div
            className={`nav-item ${activeView === 'catalog' && !editingProduct && !showProductForm && !showCheckout ? 'active' : ''}`}
            onClick={() => handleNavClick('catalog')}
            title="My Catalog"
          >
            📦
          </div>
        )}

        {/* Marketplace Icon (Primary Wholesaler Market) - Visible only to Wholesaler/Retailer */}
        {currentUserType !== 'consumer' && (
          <div
              className={`nav-item ${activeView === 'marketplace' && !showCheckout ? 'active' : ''}`}
              onClick={() => handleNavClick('marketplace')}
              title="Wholesaler Market"
          >
            🏢
          </div>
        )}

        {/* Retailer Marketplace Icon (Secondary Market) - Visible only to Retailers and Consumers */}
        {(currentUserType === 'retailer' || currentUserType === 'consumer') && (
          <div
              className={`nav-item ${activeView === 'retailer_marketplace' && !showCheckout ? 'active' : ''}`}
              onClick={() => handleNavClick('retailer_marketplace')}
              title="Retailer Resale Market"
          >
              🔄
          </div>
        )}

        {/* Purchase History Icon (Visible to all logged-in users) */}
        {canViewPurchaseHistory && (
             <div
                className={`nav-item ${activeView === 'purchase_history' && !showCheckout ? 'active' : ''}`}
                onClick={() => handleNavClick('purchase_history')}
                title="Purchase History"
            >
                🧾
            </div>
        )}

        {/* NEW: Pending Orders (Visible to Sellers) */}
        {isSeller && (
             <div
                className={`nav-item ${activeView === 'pending_orders' && !showCheckout ? 'active' : ''}`}
                onClick={() => handleNavClick('pending_orders')}
                title="Pending Orders"
            >
                🚚
            </div>
        )}

        {/* Revenue Dashboard Icon (Visible to Sellers) */}
        {isSeller && (
             <div
                className={`nav-item ${activeView === 'revenue_dashboard' && !showCheckout ? 'active' : ''}`}
                onClick={() => handleNavClick('revenue_dashboard')}
                title="Revenue Dashboard"
            >
                📊
            </div>
        )}
      </div>

      {/* 4. Main Content Area */}
      <div className="main-content">
        <h2 style={{ color: 'var(--color-text-light)' }}>Welcome, {user ? user.displayName : 'User'}!</h2>
        <p style={{ color: 'var(--color-secondary)', marginBottom: '30px' }}>You are logged in as a **{currentUserType}**.</p>

        {content}
      </div>

      {/* 5. Floating Action Button (FAB) for Add Product (Visible only to Wholesaler/Retailer) */}
      {/* FIX: Changed isBuyer to isSeller for the FAB (only sellers can add products) */}
      {isSeller && !editingProduct && !showProductForm && !showCheckout && activeView === 'catalog' && (
        <button className="fab" onClick={handleAddProductClick} title="Add New Product">
          ➕
        </button>
      )}

      {/* 6. Cart Popup Render */}
      {showCartPopup && renderCartPopup()}

      {/* 7. Product Detail Popup Render */}
      {selectedProduct && renderProductDetailPopup()}

      {/* 8. Status Popup Render (Buyer) */}
      {selectedOrderForStatus && renderStatusPopup()}

      {/* 9. Notification Popup Render */}
      <NotificationPopup />

    </div>
  );
}

export default HomePage;
