# Testing Checklist

## Quick Visual Check
1. ✅ **Streak banner** appears at top with fire emoji
2. ✅ **Daily Status Review** section shows 6 tasks (one per status field)
3. ✅ **"Pick a CPD to Review"** button is visible
4. ✅ **Weekly routine** is collapsed (shows "expand")
5. ✅ **History** is collapsed (shows "expand")

## Core Functionality Tests

### Test 1: Auto-completion
1. Click "Pick a CPD to Review" button
2. **Expected**: A CPD node is selected and shown in panel
3. **Expected**: All 6 daily tasks should auto-complete (show ✅)
4. **Expected**: Completed tasks should be grayed out with strikethrough

### Test 2: Manual CPD Selection
1. Click any CPD node in the graph
2. **Expected**: CPD details appear in panel
3. **Expected**: All 6 daily tasks auto-complete
4. **Expected**: Tasks stay completed after page reload

### Test 3: localStorage Persistence
1. Complete some tasks (by viewing a CPD)
2. Refresh the page (F5 or Cmd+R)
3. **Expected**: Completed tasks remain completed
4. **Expected**: Streak persists

### Test 4: Daily Reset
1. Note which tasks are completed today
2. Open browser console (F12)
3. Run: `localStorage.setItem('lastDailyKey', '2000-01-01')`
4. Refresh page
5. **Expected**: All daily tasks reset (show ⭕)
6. **Expected**: Streak may reset if today was part of streak

### Test 5: Weekly Routine
1. Expand "Routine — This Week"
2. **Expected**: 4-5 weekly tasks visible
3. Check/uncheck a task
4. Refresh page
5. **Expected**: Task state persists

### Test 6: History
1. Expand "History (last 7 days)"
2. **Expected**: Shows completion % for last 7 days
3. **Expected**: Today shows current completion

### Test 7: Streak Calculation
1. Complete all 6 tasks today (view a CPD)
2. **Expected**: Streak shows "1 day"
3. Manually set yesterday as complete:
   ```javascript
   const yesterday = new Date();
   yesterday.setDate(yesterday.getDate() - 1);
   const key = yesterday.toISOString().split('T')[0];
   const state = {};
   ['review_customerResearchData', 'review_valuePropositionClarity', 'review_pricingEconomicModel'].forEach(id => state[id] = true);
   localStorage.setItem(`routine_${key}`, JSON.stringify(state));
   ```
4. Refresh page
5. **Expected**: Streak shows "2 days" (if at least 3 tasks completed yesterday)

## Edge Cases

### Test 8: No CPDs Available
1. If data.json has no CPDs, "Pick a CPD to Review" should show alert

### Test 9: CPD with Missing Status
1. View a CPD that has some status fields missing
2. **Expected**: Only fields that exist are marked as reviewed
3. **Expected**: Missing fields remain incomplete

### Test 10: Multiple CPD Views
1. View CPD A → tasks complete
2. View CPD B → tasks should still show complete (already done today)
3. **Expected**: No duplicate completion

## Quick Console Tests

```javascript
// Check current state
const today = new Date().toISOString().split('T')[0];
const state = JSON.parse(localStorage.getItem(`routine_${today}`) || '{}');
console.log('Today\'s state:', state);

// Check streak
// (Streak is calculated on render, check UI)

// Clear today's state
localStorage.removeItem(`routine_${today}`);
location.reload();

// Check all routine keys
Object.keys(localStorage).filter(k => k.startsWith('routine_'))
```

## Expected Behavior Summary

- **On page load**: Daily routine visible, weekly/history collapsed
- **View CPD**: All 6 tasks auto-complete
- **Persistence**: State survives page refresh
- **Auto-reset**: Daily tasks reset at midnight (local time)
- **Streak**: Calculated from consecutive days with 3+ tasks completed

