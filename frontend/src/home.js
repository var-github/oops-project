import React, { useState, useEffect } from 'react';
import { getAuth, signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { getDatabase, ref, get, set, onValue, remove } from 'firebase/database';
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

  // --- NEW STATE for Product Details Popup ---
  const [selectedProduct, setSelectedProduct] = useState(null);

  // --- Notification State ---
  const [notification, setNotification] = useState(null);

  // --- Product & Cart States ---
  const [wholesalerProducts, setWholesalerProducts] = useState([]);
  const [retailerProducts, setRetailerProducts] = useState([]);
  const [myProducts, setMyProducts] = useState([]);
  const [cartItems, setCartItems] = useState({});
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [editingProduct, setEditingProduct] = useState(null);

  // --- Form States (Used for both ADD and EDIT) ---
  const [productName, setProductName] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productQuantity, setProductQuantity] = useState('');
  const [minOrderQuantity, setMinOrderQuantity] = useState('');
  const [productPhoto, setProductPhoto] = useState(null);
  const [addProductLoading, setAddProductLoading] = useState(false);
  const [addProductError, setAddProductError] = useState('');
  const [addProductSuccess, setAddProductSuccess] = useState('');


  // --- Data Fetching Logic (UNCHANGED) ---
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
              setActiveView('marketplace');
          } else {
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

    fetchUserType();

    return () => {
        unsubscribeProducts();
        unsubscribeCart();
    };
  }, [userId, navigate]);

  // --- Notification Timeout Effect (UNCHANGED) ---
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000); // Notification vanishes after 3 seconds
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // --- Utility Handlers (UNCHANGED) ---

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
    setActiveView('catalog');
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
          minOrderQuantity: newMOQ, // ADDED/UPDATED
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
      setActiveView('catalog');
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
    const moq = product.minOrderQuantity || 1;

    let requestedQuantity;

    if (change === -1 && currentQuantity <= moq && currentQuantity > 0) {
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

  const handleManualQuantityChange = (product, event) => {
    let value = event.target.value;

    if (value === "") {
        return;
    }

    let newQuantity = parseInt(value, 10);
    if (isNaN(newQuantity) || newQuantity < 0) {
        newQuantity = 0;
    }

    updateCartItem(product, newQuantity);
  };

  // --- Inline Component for Quantity Control (UNCHANGED) ---
  const CartQuantityControl = ({ product }) => {
    const sellerId = product.wholesalerId;
    const productId = product.id;
    const currentQuantity = cartItems[sellerId]?.[productId]?.quantity || 0;
    const moq = product.minOrderQuantity || 1;

    return (
      <div className="quantity-control-container">
        <button
          onClick={() => handleUpdateCartQuantity(product, -1)}
          className="quantity-btn decrement"
          // Disable decrement if current quantity is 0
          disabled={currentQuantity === 0}
        >
          -
        </button>
        <input
            type="number"
            value={currentQuantity}
            onChange={(e) => handleManualQuantityChange(product, e)}
            onBlur={(e) => handleManualQuantityChange(product, e)}
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

  // --- Product Detail Popup (UPDATED CSS CLASS) ---
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
                // No onClick handler here to avoid Base64 new tab issue
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


  // --- Render Sections (UNCHANGED) ---

  const renderProductForm = (isEditing) => (
    <div className="form-container" style={{ border: `1px solid var(${isEditing ? '--color-warning' : '--color-primary'})` }}>
        <h3 style={{ color: `var(${isEditing ? '--color-warning' : '--color-primary'})` }}>
            {isEditing ? `Edit Product: ${editingProduct.name}` : 'Add New Product'} 🛍️
        </h3>
        {addProductError && <p className="form-error">{addProductError}</p>}
        {addProductSuccess && <p className="form-success">{addProductSuccess}</p>}

        <form onSubmit={isEditing ? handleUpdateProduct : handleAddProduct}>
          <label>Name:</label><input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} required />
          <label>Price (₹):</label><input type="number" value={productPrice} onChange={(e) => setProductPrice(e.target.value)} required min="0.01" step="0.01" />
          <label>Quantity (Stock):</label><input type="number" value={productQuantity} onChange={(e) => setProductQuantity(e.target.value)} required min="1" step="1" />

          {/* Minimum Order Quantity Field */}
          <label>Minimum Order Quantity (Optional, Default 1):</label>
          <input
            type="number"
            value={minOrderQuantity}
            onChange={(e) => setMinOrderQuantity(e.target.value)}
            min="1"
            step="1"
            placeholder="1"
          />

          <label>{isEditing ? 'Change Photo (Optional):' : 'Photo:'}</label>
          <input type="file" accept="image/*" onChange={handlePhotoChange} required={!isEditing} />
          {(isEditing && editingProduct.photoBase64) && <img src={editingProduct.photoBase64} alt="Current" style={{ maxWidth: '80px', maxHeight: '80px', objectFit: 'contain', marginTop: '5px', border: '1px solid #ddd' }} />}

          <div className="form-action-buttons">
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

  const renderWholesalerMarketplace = () => (
    <div style={{ marginTop: '20px' }}>
      <h3 className="section-header" style={{ color: 'var(--color-primary)' }}>Wholesale Marketplace ({wholesalerProducts.length})</h3>
      {wholesalerProducts.length === 0 ? (
        <p>No products currently listed by wholesalers.</p>
      ) : (
        <div className="product-grid">
          {wholesalerProducts.map((product) => {
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
                <img src={product.photoBase64} alt={product.name} />
                <p className="product-name">{product.name}</p>
                <p className="product-price">Price: ₹ {product.price.toFixed(2)}</p>
                <p className="product-moq-label">MOQ: {moq}</p>

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

  const renderRetailerMarketplace = () => (
    <div style={{ marginTop: '20px' }}>
      <h3 className="section-header" style={{ color: 'var(--color-info)' }}>Retailer Marketplace ({retailerProducts.length})</h3>
      {retailerProducts.length === 0 ? (
        <p>No products currently listed by other retailers.</p>
      ) : (
        <div className="product-grid">
          {retailerProducts.map((product) => {
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
                <img src={product.photoBase64} alt={product.name} />
                <p className="product-name">{product.name}</p>
                <p className="product-price">Price: ₹ {product.price.toFixed(2)}</p>
                <p className="product-moq-label">MOQ: {moq} | Seller: {product.wholesalerName}</p>

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

  const renderCartPopup = () => {
    // 1. Create a consolidated map of all currently available products
    const allAvailableProducts = [...wholesalerProducts, ...retailerProducts, ...myProducts];
    const allAvailableProductsMap = allAvailableProducts.reduce((acc, product) => {
        acc[product.id] = product;
        return acc;
    }, {});


    // 2. Flatten and process cart items
    const cartDisplayItems = Object.values(cartItems).flatMap(Object.values).map(cartItem => {
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
                isBelowMOQ: cartItem.quantity < moq, // Check if below MOQ
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


    let totalItems = 0;
    let totalPrice = 0;

    cartDisplayItems.forEach(item => {
        totalItems += item.quantity;
        totalPrice += item.subtotal;
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
                <button className="btn-primary" style={{ marginTop: '15px', width: '100%' }}>Proceed to Checkout</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };


  // --- Main Render Logic ---

  if (loadingUserType || loadingProducts) {
    return <div style={{ padding: '50px', textAlign: 'center' }}>Loading...</div>;
  }

  // isBuyer is true for both 'wholesaler' and 'retailer'
  const isBuyer = currentUserType !== 'consumer';
  const totalItems = Object.values(cartItems).flatMap(Object.values).reduce((sum, item) => sum + item.quantity, 0);

  let content;
  if (editingProduct) {
    content = renderProductForm(true);
  } else if (showProductForm) {
    content = renderProductForm(false);
  } else if (activeView === 'catalog' && isBuyer) {
    content = renderMyProductsList();
  } else if (activeView === 'marketplace' && currentUserType !== 'consumer') {
    // Wholesaler Market visible only to Wholesalers/Retailers
    content = renderWholesalerMarketplace();
  } else if (activeView === 'retailer_marketplace' && (currentUserType === 'retailer' || currentUserType === 'consumer')) {
    // Retailer Market visible only to Retailers and Consumers
    content = renderRetailerMarketplace();
  } else {
    // Default Fallback Logic
    if (currentUserType === 'wholesaler' || currentUserType === 'retailer') {
        // Wholesaler/Retailer defaults to Wholesaler Marketplace
        content = renderWholesalerMarketplace();
        // Set view to 'marketplace' if a Wholesaler was stuck on 'retailer_marketplace'
        if (currentUserType === 'wholesaler' && activeView === 'retailer_marketplace') {
            setActiveView('marketplace');
        }
    } else {
        // Consumer defaults to Retailer Marketplace
        content = renderRetailerMarketplace();
    }
  }


  return (
    <div style={{ fontFamily: 'Arial, sans-serif', margin: 0, padding: 0, backgroundColor: 'var(--color-background)', minHeight: '100vh' }}>
      {/* 1. Global Styles and CSS Variables */}
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


        .header { background-color: var(--color-header); color: white; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; position: fixed; top: 0; left: 0; right: 0; z-index: 1000; height: 50px; }
        .nav-links-mobile { display: none; } /* Hidden by default */
        .header-left { display: flex; align-items: center; }

        .icon-btn { background: none; border: none; color: white; cursor: pointer; font-size: 1.5rem; margin: 0 5px; padding: 5px; position: relative; transition: color var(--transition-speed); }
        .icon-btn:hover { color: var(--color-warning); }

        .cart-badge { font-size: 0.6em; position: absolute; top: 5px; right: 15px; background-color: var(--color-danger); color: white; border-radius: 50%; padding: 2px 5px; }

        /* --- SIDEBAR (Desktop View) --- */
        .sidebar {
            position: fixed;
            top: 60px;
            left: 0;
            width: 60px;
            height: 100%;
            background-color: var(--color-background);
            padding-top: 20px;
            border-right: 1px solid #ddd;
            z-index: 999;
        }

        /* Nav Item Styles */
        .nav-item { margin-bottom: 20px; text-align: center; cursor: pointer; padding: 10px 0; font-size: 1.5rem; transition: background-color var(--transition-speed), color var(--transition-speed); }

        /* Logout Button Specific Style (Improved) */
        .logout-icon-container {
            color: var(--color-danger);
            margin-top: -10px;
            padding: 10px 0;
            transition: background-color var(--transition-speed);
        }
        .logout-icon-container .material-symbols-outlined {
            font-size: 1.8rem;
            line-height: 1.5rem;
            transition: color var(--transition-speed);
        }
        .logout-icon-container:hover {
            background-color: var(--color-danger);
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


        /* --- MAIN CONTENT (Desktop View) --- */
        .main-content { margin-top: 50px; margin-left: 60px; padding: 20px; max-width: 1000px; margin-right: auto; margin-left: auto; background-color: var(--color-background); min-height: calc(100vh - 50px); }

        .product-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }

        /* Glass Effect for Product Card */
        .product-card {
            background-color: var(--color-bg-card);
            border: 1px solid rgba(255, 255, 255, 0.3); /* Light border for glass effect */
            border-radius: var(--border-radius);
            padding: 15px; text-align: center;
            box-shadow: var(--box-shadow-glass);
            transition: transform var(--transition-speed), box-shadow var(--transition-speed);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }
        .product-card:hover { transform: translateY(-5px); box-shadow: 0 8px 20px rgba(0,0,0,0.15); }
        .product-card img { width: 100%; height: 140px; object-fit: cover; border-radius: calc(var(--border-radius) - 2px); margin-bottom: 10px; }
        .product-name { font-weight: bold; margin: 0 0 5px 0; font-size: 1.1em; color: var(--color-text-light); }
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
        form label { display: block; text-align: left; margin-top: 15px; margin-bottom: 5px; font-weight: bold; color: var(--color-secondary); }
        form input[type="text"], form input[type="number"], form input[type="file"], form select {
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            border: 1px solid #ccc;
            border-radius: var(--border-radius);
            box-sizing: border-box;
            font-size: 1em;
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

        /* ======================================= */
        /* --- MOBILE FRIENDLY MEDIA QUERIES --- */
        /* ======================================= */
        @media (max-width: 768px) {
            /* 1. Header Navigation */
            .header {
                height: 50px;
                padding: 5px 15px;
            }
            .sidebar { display: none; } /* Hide Sidebar */

            /* Display Mobile Nav Links */
            .nav-links-mobile {
                display: flex;
                gap: 5px;
                padding-left: 5px;
            }

            /* Style Mobile Nav Items (Icon buttons) */
            .nav-item-mobile {
                background: none;
                border: none;
                color: white;
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

            /* 2. Main Content Adjustment */
            .main-content {
                margin-top: 50px; /* Use full width */
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

            /* 4. Product Detail Popup */
            .product-detail-content {
                width: 100%;
                height: 120%;
                border-radius: 0;
                padding: 20px;
                overflow-y: auto;
            }
            .product-detail-overlay {
                align-items: flex-start; /* Start from the top */
                justify-content: center;
            }
            .detail-body { flex-direction: column; }
            .detail-photo-container { max-width: 100%; margin-bottom: 20px; }
            .detail-header h3 { font-size: 1.5rem; }

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

        }
      `}</style>


      {/* 2. Fixed Header */}
      <div className="header">
        <div className="header-left">
            <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Shopping Mart</span>

            {/* Mobile Navigation Links */}
            <div className="nav-links-mobile">
                {/* Catalog Icon (Visible only to Wholesaler/Retailer) */}
                {isBuyer && (
                    <button
                        className={`nav-item-mobile ${activeView === 'catalog' && !editingProduct && !showProductForm ? 'active' : ''}`}
                        onClick={() => { setActiveView('catalog'); setShowProductForm(false); setEditingProduct(null); }}
                        title="My Catalog"
                    >
                        📦
                    </button>
                )}

                {/* Marketplace Icon (Primary Wholesaler Market) - Visible only to Wholesaler/Retailer */}
                {currentUserType !== 'consumer' && (
                    <button
                        className={`nav-item-mobile ${activeView === 'marketplace' ? 'active' : ''}`}
                        onClick={() => { setActiveView('marketplace'); setShowProductForm(false); setEditingProduct(null); }}
                        title="Wholesaler Market"
                    >
                        🏢
                    </button>
                )}

                {/* Retailer Marketplace Icon (Secondary Market) - Visible only to Retailers and Consumers */}
                {(currentUserType === 'retailer' || currentUserType === 'consumer') && (
                    <button
                        className={`nav-item-mobile ${activeView === 'retailer_marketplace' ? 'active' : ''}`}
                        onClick={() => { setActiveView('retailer_marketplace'); setShowProductForm(false); setEditingProduct(null); }}
                        title="Retailer Resale Market"
                    >
                        🔄
                    </button>
                )}
            </div>
        </div>

        <div>
          {/* Cart Icon */}
          <button className="icon-btn" onClick={() => setShowCartPopup(true)} title="View Cart">
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

      {/* 3. Sidebar Navigation (Desktop only) */}
      <div className="sidebar">
        {/* Catalog Icon (Visible only to Wholesaler/Retailer) */}
        {isBuyer && (
          <div
            className={`nav-item ${activeView === 'catalog' && !editingProduct && !showProductForm ? 'active' : ''}`}
            onClick={() => { setActiveView('catalog'); setShowProductForm(false); setEditingProduct(null); }}
            title="My Catalog"
          >
            📦
          </div>
        )}

        {/* Marketplace Icon (Primary Wholesaler Market) - Visible only to Wholesaler/Retailer */}
        {currentUserType !== 'consumer' && (
          <div
            className={`nav-item ${activeView === 'marketplace' ? 'active' : ''}`}
            onClick={() => { setActiveView('marketplace'); setShowProductForm(false); setEditingProduct(null); }}
            title="Wholesaler Market"
          >
            🏢
          </div>
        )}

        {/* Retailer Marketplace Icon (Secondary Market) - Visible only to Retailers and Consumers */}
        {(currentUserType === 'retailer' || currentUserType === 'consumer') && (
          <div
              className={`nav-item ${activeView === 'retailer_marketplace' ? 'active' : ''}`}
              onClick={() => { setActiveView('retailer_marketplace'); setShowProductForm(false); setEditingProduct(null); }}
              title="Retailer Resale Market"
          >
              🔄
          </div>
        )}

        {/* Logout (Moved to header on mobile, kept here for desktop consistency) */}
        {/* <div className="nav-item logout-icon-container" onClick={handleLogout} title="Logout">
          <span className="material-symbols-outlined">
            power_settings_new
          </span>
        </div> */}
      </div>

      {/* 4. Main Content Area */}
      <div className="main-content">
        <h2 style={{ color: 'var(--color-text-light)' }}>Welcome, {user ? user.displayName : 'User'}!</h2>
        <p style={{ color: 'var(--color-secondary)', marginBottom: '30px' }}>You are logged in as a **{currentUserType}**.</p>

        {content}
      </div>

      {/* 5. Floating Action Button (FAB) for Add Product (Visible only to Wholesaler/Retailer) */}
      {isBuyer && !editingProduct && !showProductForm && (
        <button className="fab" onClick={handleAddProductClick} title="Add New Product">
          ➕
        </button>
      )}

      {/* 6. Cart Popup Render */}
      {showCartPopup && renderCartPopup()}

      {/* 7. Product Detail Popup Render */}
      {selectedProduct && renderProductDetailPopup()}

      {/* 8. Notification Popup Render */}
      <NotificationPopup />

    </div>
  );
}

export default HomePage;



