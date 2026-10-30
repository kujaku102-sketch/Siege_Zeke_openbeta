import { reject, selectedArray, selectedField, selectedObject } from './common.js';

export function securityEligibilityView(card) {
  const code = 'INVALID_AUTHORITY';
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const id = selectedField(card, 'id', code);
    const category = selectedField(card, 'category', code);
    const printed = selectedField(card, 'printedCategory', code, null);
    const rawText = selectedField(card, 'text', code, '');
    if (typeof id !== 'string' || typeof category !== 'string'
      || (printed !== null && printed !== undefined && typeof printed !== 'string')
      || (rawText !== undefined && typeof rawText !== 'string') || rawText === null) reject(code);

    const rawCompiled = selectedField(card, 'compiled', code, null);
    let compiled = null;
    if (rawCompiled !== null && rawCompiled !== undefined) {
      selectedObject(rawCompiled, code, ancestors);
      try {
        const keywords = selectedField(rawCompiled, 'keywords', code);
        compiled = { keywords: selectedArray(keywords, code, ancestors, item => {
          selectedObject(item, code, ancestors);
          try {
            const name = selectedField(item, 'name', code);
            const intrinsic = selectedField(item, 'intrinsic', code, true);
            if (typeof name !== 'string' || (intrinsic !== null && intrinsic !== undefined && typeof intrinsic !== 'boolean')) reject(code);
            return { name, intrinsic: intrinsic ?? true };
          } finally { ancestors.delete(item); }
        }) };
      } finally { ancestors.delete(rawCompiled); }
    }

    const rawGranted = selectedField(card, 'grantedKeywords', code, []);
    const grantedKeywords = rawGranted === null || rawGranted === undefined ? []
      : selectedArray(rawGranted, code, ancestors, item => {
        if (typeof item !== 'string') reject(code);
        return item;
      });
    const rawTimed = selectedField(card, 'timedModifiers', code, []);
    const timedModifiers = rawTimed === null || rawTimed === undefined ? []
      : selectedArray(rawTimed, code, ancestors, item => {
        selectedObject(item, code, ancestors);
        try {
          const keyword = selectedField(item, 'keyword', code, null);
          if (keyword !== null && keyword !== undefined && typeof keyword !== 'string') reject(code);
          return { keyword: keyword ?? null };
        } finally { ancestors.delete(item); }
      });
    const rawMounted = selectedField(card, 'mounted', code, []);
    const mounted = rawMounted === null || rawMounted === undefined ? []
      : selectedArray(rawMounted, code, ancestors, provider => {
        selectedObject(provider, code, ancestors);
        try {
          const providerId = selectedField(provider, 'id', code);
          const protectConsumed = selectedField(provider, 'protectConsumed', code, false);
          if (typeof providerId !== 'string' || (protectConsumed !== null && protectConsumed !== undefined && typeof protectConsumed !== 'boolean')) reject(code);
          return { id: providerId, protectConsumed: protectConsumed ?? false };
        } finally { ancestors.delete(provider); }
      });
    return {
      id, category, printedCategory: printed ?? null, text: rawText ?? '', compiled,
      grantedKeywords, timedModifiers, mounted
    };
  } finally { ancestors.delete(card); }
}
