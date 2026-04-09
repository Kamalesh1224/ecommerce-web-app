const products = Array.isArray(window.productsData) ? window.productsData : [];
const selectedProductIds = new Set();
const interactionTracker = window.interactionTracker || null;
const productById = new Map(products.map((item) => [item.id, item]));

const categoryFilter = document.getElementById("categoryFilter");
const budgetFilter = document.getElementById("budgetFilter");
const ratingFilter = document.getElementById("ratingFilter");
const ratingValue = document.getElementById("ratingValue");
const resetFilters = document.getElementById("resetFilters");
const recommendedList = document.getElementById("recommendedList");
const catalogList = document.getElementById("catalogList");
const recommendationMeta = document.getElementById("recommendationMeta");
const catalogMeta = document.getElementById("catalogMeta");
const notificationList = document.getElementById("notificationList");
const notificationMeta = document.getElementById("notificationMeta");
const notificationEmpty = document.getElementById("notificationEmpty");
const enableNotificationsButton = document.getElementById("enableNotifications");
const flowMeta = document.getElementById("flowMeta");

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

function getFeatures(product) {
  return Array.isArray(product.features) ? product.features : [];
}

function getNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOriginalPrice(product) {
  const original = getNumber(product.originalPrice, 0);
  return original > product.price ? original : product.price;
}

function getDiscountPercent(product) {
  const original = getOriginalPrice(product);
  if (original <= product.price) {
    return 0;
  }
  return Math.max(0, Math.round(((original - product.price) / original) * 100));
}

function getInventory(product) {
  return Math.max(0, Math.round(getNumber(product.inventory, 0)));
}

function getSoldVelocity(product) {
  return Math.max(0, Math.round(getNumber(product.soldLast24h, 0)));
}

function getDeliveryDays(product) {
  return Math.max(1, Math.round(getNumber(product.deliveryDays, 3)));
}

function getStockSignal(product) {
  const inventory = getInventory(product);
  if (inventory <= 10) {
    return {
      text: inventory > 0 ? `Only ${inventory} left` : "Out of stock",
      className: "signal-chip stock-low"
    };
  }
  return {
    text: "In stock",
    className: "signal-chip stock-good"
  };
}

function getSignalChips(product) {
  const chips = [];
  chips.push(getStockSignal(product));

  const deliveryDays = getDeliveryDays(product);
  if (deliveryDays <= 2) {
    chips.push({
      text: `Delivery in ${deliveryDays} day${deliveryDays === 1 ? "" : "s"}`,
      className: "signal-chip delivery-fast"
    });
  }

  const sold = getSoldVelocity(product);
  if (sold >= 25) {
    chips.push({
      text: `${sold} sold today`,
      className: "signal-chip trending"
    });
  }

  return chips;
}

function getBehaviorProfile() {
  if (!interactionTracker || typeof interactionTracker.getData !== "function") {
    return {
      hasSignals: false,
      clickedProducts: {},
      viewedCategories: {},
      featureSignals: {}
    };
  }

  const data = interactionTracker.getData();
  const clickedProducts = data && data.clickedProducts ? data.clickedProducts : {};
  const viewedCategories = data && data.viewedCategories ? data.viewedCategories : {};
  const featureSignals = {};

  Object.entries(clickedProducts).forEach(([productId, count]) => {
    const product = productById.get(productId);
    if (!product) {
      return;
    }

    getFeatures(product).forEach((feature) => {
      featureSignals[feature] = (featureSignals[feature] || 0) + count;
    });
  });

  const hasSignals = Object.keys(clickedProducts).length > 0 || Object.keys(viewedCategories).length > 0;
  return { hasSignals, clickedProducts, viewedCategories, featureSignals };
}

function behaviorBoost(product, behaviorProfile) {
  if (!behaviorProfile || !behaviorProfile.hasSignals) {
    return { score: 0, reasons: [] };
  }

  let score = 0;
  const reasons = [];

  const categoryViews = Number(behaviorProfile.viewedCategories[product.category]) || 0;
  if (categoryViews > 0) {
    score += Math.min(24, categoryViews * 6);
    reasons.push("from viewed category");
  }

  const clickCount = Number(behaviorProfile.clickedProducts[product.id]) || 0;
  if (clickCount > 0) {
    score += Math.min(20, clickCount * 8);
    reasons.push("clicked before");
  }

  const featureScore = getFeatures(product).reduce((total, feature) => {
    return total + (Number(behaviorProfile.featureSignals[feature]) || 0);
  }, 0);

  if (featureScore > 0) {
    score += Math.min(26, featureScore * 2.5);
    reasons.push("similar to clicked products");
  }

  return { score: Math.round(score), reasons };
}

function getDetailHref(product) {
  return `product-detail.html?id=${encodeURIComponent(product.id || "")}`;
}

function formatFeatures(features, limit = 3) {
  if (!features.length) {
    return "general";
  }
  return features.slice(0, limit).join(", ");
}

function commerceBoost(product) {
  let score = 0;
  const reasons = [];

  const discount = getDiscountPercent(product);
  if (discount >= 10) {
    score += Math.min(14, discount * 0.6);
    reasons.push(`${discount}% off`);
  }

  const sold = getSoldVelocity(product);
  if (sold >= 25) {
    score += Math.min(16, sold * 0.25);
    reasons.push("trending now");
  }

  const deliveryDays = getDeliveryDays(product);
  if (deliveryDays <= 2) {
    score += 7;
    reasons.push("fast delivery");
  }

  const inventory = getInventory(product);
  if (inventory > 0 && inventory <= 10) {
    score += 5;
    reasons.push("limited stock");
  }
  if (inventory === 0) {
    score -= 45;
    reasons.push("currently out of stock");
  }

  return { score: Math.round(score), reasons };
}

function diversifyRank(entries, limit) {
  const remaining = entries.slice().sort((a, b) => b.score - a.score);
  const selected = [];
  const categoryCount = {};

  while (selected.length < limit && remaining.length) {
    remaining.forEach((entry) => {
      const used = categoryCount[entry.product.category] || 0;
      entry.adjustedScore = entry.score - used * 12;
    });

    remaining.sort((a, b) => b.adjustedScore - a.adjustedScore);
    const next = remaining.shift();
    selected.push(next);
    categoryCount[next.product.category] = (categoryCount[next.product.category] || 0) + 1;
  }

  return selected;
}

function getInteractionData() {
  if (!interactionTracker || typeof interactionTracker.getData !== "function") {
    return {};
  }
  return interactionTracker.getData();
}

function refreshNotifications() {
  if (!window.smartNotifications || !notificationList) {
    return;
  }

  window.smartNotifications.render({
    products,
    interactions: getInteractionData(),
    listElement: notificationList,
    metaElement: notificationMeta,
    emptyElement: notificationEmpty,
    maxItems: 6,
    enableBrowser: true
  });
}

function setupNotificationControls() {
  if (!window.smartNotifications || !enableNotificationsButton) {
    return;
  }

  window.smartNotifications.attachPermissionButton(enableNotificationsButton, refreshNotifications);
}

function updateFlowMeta() {
  if (!flowMeta) {
    return;
  }

  const categories = new Set(products.map((item) => item.category));
  const tracked = getInteractionData();
  const clickCount = Object.values(tracked.clickedProducts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  flowMeta.textContent = `${products.length} products | ${categories.size} categories | ${clickCount} tracked interactions`;
}

function getCategories() {
  const unique = [...new Set(products.map((item) => item.category))];
  return ["All", ...unique];
}

function fillCategoryFilter() {
  getCategories().forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });
}

function relevanceScore(product, selectedCategory, budget, minRating, behaviorProfile) {
  let score = 0;
  const reasons = [];

  if (selectedCategory !== "All" && product.category === selectedCategory) {
    score += 40;
    reasons.push("category match");
  } else if (selectedCategory === "All") {
    score += 12;
  }

  const ratingWeight = product.rating * 10;
  score += ratingWeight;
  if (product.rating >= Math.max(4.3, minRating)) {
    reasons.push("high rating");
  }

  if (!Number.isNaN(budget) && budget > 0) {
    const distance = Math.abs(product.price - budget);
    const budgetScore = Math.max(0, 30 - distance * 0.3);
    score += budgetScore;
    if (product.price <= budget) {
      reasons.push("within budget");
    }
  }

  const behavior = behaviorBoost(product, behaviorProfile);
  score += behavior.score;
  reasons.push(...behavior.reasons);

  const commerce = commerceBoost(product);
  score += commerce.score;
  reasons.push(...commerce.reasons);

  return { score: Math.round(score), reasons };
}

function buildPreferenceProfile() {
  const selectedProducts = products.filter((item) => selectedProductIds.has(item.id));
  const categories = new Set();
  const features = new Set();

  selectedProducts.forEach((product) => {
    categories.add(product.category);
    getFeatures(product).forEach((feature) => features.add(feature));
  });

  return { selectedProducts, categories, features };
}

function personalizedScore(product, profile, selectedCategory, budget, minRating, behaviorProfile) {
  let score = 0;
  const reasons = [];

  if (profile.categories.has(product.category)) {
    score += 45;
    reasons.push("same category");
  }

  const overlap = getFeatures(product).filter((feature) => profile.features.has(feature));
  if (overlap.length) {
    score += Math.min(40, overlap.length * 16);
    reasons.push(`shared features: ${overlap.slice(0, 2).join(", ")}`);
  }

  if (selectedCategory !== "All" && product.category === selectedCategory) {
    score += 14;
    reasons.push("matches category filter");
  }

  const ratingWeight = product.rating * 9;
  score += ratingWeight;
  if (product.rating >= Math.max(4.3, minRating)) {
    reasons.push("high rating");
  }

  if (!Number.isNaN(budget) && budget > 0) {
    const distance = Math.abs(product.price - budget);
    const budgetScore = Math.max(0, 25 - distance * 0.25);
    score += budgetScore;
    if (product.price <= budget) {
      reasons.push("within budget");
    }
  }

  const behavior = behaviorBoost(product, behaviorProfile);
  score += behavior.score;
  reasons.push(...behavior.reasons);

  const commerce = commerceBoost(product);
  score += commerce.score;
  reasons.push(...commerce.reasons);

  return { score: Math.round(score), reasons };
}

function createCard(product, mode = "catalog", scorePayload = null) {
  const card = document.createElement("article");
  card.className = "product-card";

  if (mode === "recommended") {
    card.classList.add("recommended");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Recommended for You";
    card.appendChild(badge);
  }

  const title = document.createElement("h3");
  title.className = "product-name";
  title.textContent = product.productName;

  const brand = document.createElement("p");
  brand.className = "product-brand";
  brand.textContent = `Brand: ${product.brand || "SmartCart Select"}`;

  const category = document.createElement("p");
  category.className = "product-meta";
  category.textContent = `Category: ${product.category}`;

  const features = document.createElement("p");
  features.className = "product-meta features";
  features.textContent = `Features: ${formatFeatures(getFeatures(product))}`;

  const priceWrap = document.createElement("div");
  priceWrap.className = "price-row";

  const price = document.createElement("p");
  price.className = "price";
  price.textContent = currency.format(product.price);

  priceWrap.appendChild(price);

  const originalPrice = getOriginalPrice(product);
  if (originalPrice > product.price) {
    const oldPrice = document.createElement("p");
    oldPrice.className = "old-price";
    oldPrice.textContent = currency.format(originalPrice);

    const discountPill = document.createElement("span");
    discountPill.className = "discount-pill";
    discountPill.textContent = `${getDiscountPercent(product)}% OFF`;

    priceWrap.append(oldPrice, discountPill);
  }

  const rating = document.createElement("p");
  rating.className = "rating";
  rating.textContent = `Rating: ${product.rating.toFixed(1)} / 5`;

  const signals = document.createElement("div");
  signals.className = "signal-row";

  getSignalChips(product).forEach((chip) => {
    const chipElement = document.createElement("span");
    chipElement.className = chip.className;
    chipElement.textContent = chip.text;
    signals.appendChild(chipElement);
  });

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const detailLink = document.createElement("a");
  detailLink.className = "product-link";
  detailLink.href = getDetailHref(product);
  detailLink.textContent = "View Details";
  detailLink.addEventListener("click", () => {
    if (interactionTracker && typeof interactionTracker.trackProductClick === "function") {
      interactionTracker.trackProductClick(product.id, product.category);
    }
  });

  actions.appendChild(detailLink);

  card.append(title, brand, category, features, priceWrap, rating, signals);
  card.appendChild(actions);

  if (mode === "catalog") {
    const picker = document.createElement("label");
    picker.className = "pick-toggle";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "product-picker";
    checkbox.dataset.productId = product.id;
    checkbox.checked = selectedProductIds.has(product.id);

    const pickerText = document.createElement("span");
    pickerText.textContent = "Tick for personalization";

    picker.append(checkbox, pickerText);
    card.appendChild(picker);
  }

  if (mode === "recommended" && scorePayload) {
    const relevance = document.createElement("p");
    relevance.className = "relevance";
    const reasonText = scorePayload.reasons.length
      ? scorePayload.reasons.slice(0, 4).join(" | ")
      : "good overall fit";
    relevance.textContent = `Related score ${scorePayload.score}: ${reasonText}`;
    card.appendChild(relevance);
  }

  return card;
}

function renderCatalog(selectedCategory, minRating) {
  catalogList.innerHTML = "";

  const filtered = products.filter((item) => {
    const categoryOk = selectedCategory === "All" || item.category === selectedCategory;
    const ratingOk = item.rating >= minRating;
    return categoryOk && ratingOk;
  });

  if (!filtered.length) {
    const selectedCount = selectedProductIds.size;
    catalogMeta.textContent = selectedCount
      ? `No products found for this filter. ${selectedCount} selected for personalization.`
      : "No products found for this filter.";
    return;
  }

  const selectedCount = selectedProductIds.size;
  catalogMeta.textContent = selectedCount
    ? `${filtered.length} products in view | ${selectedCount} selected for personalization`
    : `${filtered.length} products in view`;
  filtered.forEach((product) => catalogList.appendChild(createCard(product)));
}

function renderRecommendations(selectedCategory, budget, minRating) {
  recommendedList.innerHTML = "";

  const hasPersonalization = selectedProductIds.size > 0;
  const preferenceProfile = buildPreferenceProfile();
  const behaviorProfile = getBehaviorProfile();

  let ranked;
  if (hasPersonalization) {
    ranked = diversifyRank(products
      .filter((product) => !selectedProductIds.has(product.id))
      .map((product) => {
        const payload = personalizedScore(product, preferenceProfile, selectedCategory, budget, minRating, behaviorProfile);
        return { product, ...payload };
      })
      .filter((entry) => {
        const categoryOk = selectedCategory === "All" || entry.product.category === selectedCategory;
        const ratingOk = entry.product.rating >= minRating;
        const inventoryOk = getInventory(entry.product) > 0;
        return categoryOk && ratingOk && inventoryOk;
      })
      , 4);
  } else {
    ranked = diversifyRank(products
      .map((product) => {
        const payload = relevanceScore(product, selectedCategory, budget, minRating, behaviorProfile);
        return { product, ...payload };
      })
      .filter((entry) => {
        const categoryOk = selectedCategory === "All" || entry.product.category === selectedCategory;
        const ratingOk = entry.product.rating >= minRating;
        const inventoryOk = getInventory(entry.product) > 0;
        return categoryOk && ratingOk && inventoryOk;
      })
      , 4);
  }

  if (!ranked.length) {
    recommendationMeta.textContent = hasPersonalization
      ? "No related items found. Try selecting a different product."
      : "No Recommended for You results for current filters.";
    return;
  }

  if (hasPersonalization) {
    const selectedNames = preferenceProfile.selectedProducts.map((item) => item.productName);
    const lead = selectedNames.slice(0, 2).join(", ");
    const tailCount = Math.max(0, selectedNames.length - 2);
    const suffix = tailCount ? ` +${tailCount} more` : "";
    recommendationMeta.textContent = `Recommended for You: ${ranked.length} related items based on ${lead}${suffix}`;
  } else if (behaviorProfile.hasSignals) {
    recommendationMeta.textContent = `Recommended for You: Top ${ranked.length} products from your interaction history`;
  } else {
    recommendationMeta.textContent = `Recommended for You: Top ${ranked.length} products`;
  }

  ranked.forEach((entry) => {
    recommendedList.appendChild(
      createCard(entry.product, "recommended", {
        score: entry.score,
        reasons: entry.reasons
      })
    );
  });
}

function refreshUI() {
  const selectedCategory = categoryFilter.value;
  const budget = Number(budgetFilter.value);
  const minRating = Number(ratingFilter.value);

  ratingValue.textContent = `${minRating.toFixed(1)}+`;
  renderRecommendations(selectedCategory, budget, minRating);
  renderCatalog(selectedCategory, minRating);
  refreshNotifications();
  updateFlowMeta();
}

function resetAllFilters() {
  categoryFilter.value = "All";
  budgetFilter.value = "150";
  ratingFilter.value = "3.8";
  selectedProductIds.clear();
  refreshUI();
}

function onProductToggle(event) {
  const target = event.target;
  if (!target || !target.classList || !target.classList.contains("product-picker")) {
    return;
  }

  const productId = target.dataset.productId;
  if (!productId) {
    return;
  }

  if (target.checked) {
    selectedProductIds.add(productId);
    if (interactionTracker && typeof interactionTracker.trackProductClick === "function") {
      const product = productById.get(productId);
      interactionTracker.trackProductClick(productId, product ? product.category : "");
    }
  } else {
    selectedProductIds.delete(productId);
  }

  refreshUI();
}

fillCategoryFilter();
setupNotificationControls();
resetAllFilters();

[categoryFilter, budgetFilter, ratingFilter].forEach((input) => {
  input.addEventListener("input", refreshUI);
  input.addEventListener("change", refreshUI);
});

categoryFilter.addEventListener("change", () => {
  if (
    interactionTracker &&
    typeof interactionTracker.trackCategoryView === "function" &&
    categoryFilter.value &&
    categoryFilter.value !== "All"
  ) {
    interactionTracker.trackCategoryView(categoryFilter.value);
  }
  refreshUI();
});

resetFilters.addEventListener("click", resetAllFilters);
catalogList.addEventListener("change", onProductToggle);
