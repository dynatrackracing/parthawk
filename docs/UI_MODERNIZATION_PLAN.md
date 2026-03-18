# UI Modernization Plan

## Overview

Transform the dynatrack UI from the older "rounded/gradient" style to a modern, clean design consistent with the newly built pages (PriceCheck, StaleInventory, YourSales).

## Current State Analysis

### Old Style (to be replaced)
- **Buttons**: Pill-shaped (`border-radius: 100px`), gradient hover effects
- **Inputs**: Pill-shaped (`border-radius: 100px`), no visible borders
- **Banners**: Purple gradient backgrounds with decorative SVG patterns
- **Cards**: Heavy shadows, inconsistent spacing
- **Typography**: Mixed fonts, inconsistent hierarchy

### New Style (target)
- **Buttons**: Subtle rounded (`rounded-lg`), solid colors, clean hover states
- **Inputs**: Slightly rounded (`rounded-lg`), visible borders, clear focus states
- **Headers**: Clean text-based headers without decorative backgrounds
- **Cards**: White background, subtle shadow, consistent padding
- **Tables**: Minimal styling, hover states, clean borders

---

## Design Tokens (Standard Classes)

### Buttons
```jsx
// Primary action
className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"

// Secondary action
className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-medium border border-gray-200 transition-colors"

// Danger action
className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"

// Success action
className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"

// Text link action
className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
```

### Inputs
```jsx
// Text input
className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"

// Select
className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900"

// Textarea
className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-gray-900 placeholder-gray-400"
```

### Cards
```jsx
// Standard card
className="bg-white rounded-lg shadow p-6"

// Clickable card
className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer"

// Summary stat card
className="bg-white rounded-lg shadow p-4"
```

### Page Headers
```jsx
// Page title section (replaces Banner)
<div className="mb-8">
  <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">Page Title</h1>
  <p className="text-gray-500 mt-1">Page description here</p>
</div>
```

### Tables
```jsx
// Table container
className="bg-white shadow rounded-lg overflow-hidden"

// Table header
className="bg-gray-50"

// Header cell
className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"

// Body row
className="hover:bg-gray-50"

// Body cell
className="px-4 py-4 whitespace-nowrap text-sm text-gray-900"
```

### Form Labels
```jsx
className="block text-sm font-medium text-gray-700 mb-2"
```

---

## Files to Update

### Phase 1: Core Styles (SCSS Updates)

| File | Changes |
|------|---------|
| `client/src/styles/components/_button.scss` | Update `.button` to use `rounded-lg` instead of `border-radius: 100px`. Remove pill shape. |
| `client/src/styles/components/_form.scss` | Update inputs/selects to use `rounded-lg`. Add visible borders. |
| `client/src/styles/_variables.scss` | Review and update color variables if needed |

### Phase 2: Shared Components

| Component | File | Changes |
|-----------|------|---------|
| **Banner** | `client/src/components/Banner.jsx` | Replace decorative gradient with simple header section. Remove SVG patterns. |
| **Header** | `client/src/components/header/Header.jsx` | Update button classes from `.button--dark` to Tailwind classes |
| **Sidebar** | `client/src/components/Sidebar.jsx` | Already mostly modern, minor touch-ups |
| **Table** | `client/src/components/Table.jsx` | Update to match new table styling |
| **Modal** | `client/src/components/Modal.jsx` | Update button and input styling |

### Phase 3: Page Components

| Page | File | Changes |
|------|------|---------|
| **AddItem** | `client/src/components/AddItem.jsx` | Replace Banner with simple header. Update all form inputs to new style. Update buttons. |
| **EditItem** | `client/src/components/EditItem.jsx` | Same as AddItem |
| **ItemDetail** | `client/src/components/ItemDetail.jsx` | Update card styling, buttons, table |
| **SearchItem** | `client/src/components/SearchItem.jsx` | Update search form, results display |
| **Home** | `client/src/components/home/Home.jsx` | Update layout and search form |
| **Admin** | `client/src/pages/Admin.jsx` | Update all form elements and tables |
| **Login** | `client/src/pages/Login.jsx` | Update login button styling |

### Phase 4: Intelligence Pages (Already Modern - Minor Tweaks)

| Page | File | Status |
|------|------|--------|
| **MarketDashboard** | `client/src/components/intelligence/MarketDashboard.jsx` | Review for consistency |
| **PriceCheck** | `client/src/components/intelligence/PriceCheck.jsx` | ✅ Already modern |
| **StaleInventory** | `client/src/components/intelligence/StaleInventory.jsx` | Review for consistency |
| **YourSales** | `client/src/components/intelligence/YourSales.jsx` | Review for consistency |

---

## Detailed Component Updates

### 1. Banner.jsx → PageHeader Pattern

**Before:**
```jsx
<Banner
  title="Home > Add item"
  subtitle="Start by filling the form..."
/>
```

**After:**
```jsx
<div className="mb-8">
  <div className="flex items-center text-sm text-gray-500 mb-2">
    <Link to="/" className="hover:text-gray-700">Home</Link>
    <span className="mx-2">›</span>
    <span className="text-gray-900">Add Item</span>
  </div>
  <h1 className="text-2xl md:text-3xl text-gray-800 font-bold">Add Item</h1>
  <p className="text-gray-500 mt-1">Fill out the form to add a new item to inventory</p>
</div>
```

### 2. Form Inputs

**Before (SCSS):**
```scss
input {
  border-radius: 100px;
  padding: 0 28px;
}
```

**After (Tailwind in JSX):**
```jsx
<input
  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
/>
```

### 3. Buttons

**Before:**
```jsx
<button className="button button--dark">Save Item</button>
<button className="button button--light">Cancel</button>
```

**After:**
```jsx
<button className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium transition-colors">
  Save Item
</button>
<button className="bg-white hover:bg-gray-50 text-gray-700 px-6 py-2.5 rounded-lg font-medium border border-gray-300 transition-colors">
  Cancel
</button>
```

### 4. Select Dropdowns

**Before:**
```jsx
<Select styles={customStyles} className="basic-multi-select" />
```

**After:**
```jsx
<select className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white">
  <option>Select option</option>
</select>
```
Or use a styled react-select with updated theme.

---

## Implementation Order

### Step 1: Update SCSS Globals
1. Update `_button.scss` - change border-radius to 8px
2. Update `_form.scss` - change border-radius to 8px, add borders

### Step 2: Update Shared Components
1. Create new `PageHeader` component or update `Banner`
2. Update `Header.jsx` buttons
3. Update `Table.jsx` styling

### Step 3: Update Forms (Highest Impact)
1. `AddItem.jsx` - full reskin
2. `EditItem.jsx` - full reskin
3. `SearchItem.jsx` - update search form

### Step 4: Update Other Pages
1. `ItemDetail.jsx`
2. `Home.jsx`
3. `Admin.jsx`
4. `Login.jsx`

### Step 5: Review Intelligence Pages
1. Ensure consistency across all intelligence pages
2. Minor tweaks if needed

---

## Visual Reference

### Modern Table (from PriceCheck)
- White background with subtle shadow
- Gray header row
- Hover state on rows
- Compact padding
- Small, clean action links

### Modern Cards (from MarketDashboard)
- White background
- `rounded-lg` corners
- Subtle shadow
- Consistent padding (p-4 or p-6)
- Clear typography hierarchy

### Modern Buttons
- Solid background colors
- `rounded-lg` (not pill-shaped)
- Clear hover states
- Consistent sizing

---

## Notes

1. **Preserve Functionality**: All updates are purely visual - no changes to business logic
2. **Mobile First**: Ensure all updates work on mobile
3. **Consistency**: Use the same Tailwind classes throughout
4. **Gradual Rollout**: Can be done page-by-page without breaking the app
