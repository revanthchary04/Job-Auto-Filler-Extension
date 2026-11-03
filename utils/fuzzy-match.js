/**
 * OriginFill — Fuzzy String Matching
 * Multi-strategy matching for dropdown fields (colleges, countries, states, etc.)
 * Priority: Exact → Normalized → Fuzzy (Levenshtein) → Keyword → Fallback
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillFuzzyMatch = (() => {
  'use strict';

  // ─── Levenshtein Distance (Optimized Single-Row DP) ───────────

  /**
   * Calculate the Levenshtein edit distance between two strings.
   * Uses single-row optimization for O(min(m,n)) space complexity.
   *
   * @param {string} a
   * @param {string} b
   * @returns {number} Edit distance
   */
  function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Ensure a is the shorter string (for space optimization)
    if (a.length > b.length) {
      [a, b] = [b, a];
    }

    const aLen = a.length;
    const bLen = b.length;

    // Previous row of distances
    let prevRow = new Array(aLen + 1);
    for (let i = 0; i <= aLen; i++) {
      prevRow[i] = i;
    }

    for (let j = 1; j <= bLen; j++) {
      let prev = j; // prevRow[0] for current row

      for (let i = 1; i <= aLen; i++) {
        let current;

        if (a[i - 1] === b[j - 1]) {
          current = prevRow[i - 1];
        } else {
          current = 1 + Math.min(
            prevRow[i - 1],  // substitution
            prevRow[i],      // deletion
            prev             // insertion
          );
        }

        prevRow[i - 1] = prev;
        prev = current;
      }

      prevRow[aLen] = prev;
    }

    return prevRow[aLen];
  }

  // ─── String Normalization ──────────────────────────────────────

  /**
   * Normalize a string for comparison:
   * - Lowercase
   * - Remove articles (the, of, a, an)
   * - Remove punctuation
   * - Collapse whitespace
   * - Trim
   *
   * @param {string} str
   * @returns {string}
   */
  function normalize(str) {
    if (!str) return '';

    return String(str)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')                   // Strip accents (é → e)
      .toLowerCase()
      .replace(/['’‘`]/g, '')                            // Remove apostrophes
      .replace(/[^\w\s]/g, ' ')                          // Replace punctuation with space
      .replace(/\b(the|of|a|an|and|at|in|for)\b/gi, '') // Remove articles/prepositions
      .replace(/\s+/g, ' ')                              // Collapse whitespace
      .trim();
  }

  /**
   * Extract meaningful keywords from a string.
   * @param {string} str
   * @returns {string[]}
   */
  function extractKeywords(str) {
    if (!str) return [];

    return normalize(str)
      .split(' ')
      .filter(word => word.length > 1); // Skip single-char words
  }

  // ─── Match Strategies ─────────────────────────────────────────

  /**
   * STRATEGY 1: Exact match (case-insensitive).
   *
   * @param {string} value - Target value to match
   * @param {Array<{text: string, index: number}>} options - Available options
   * @returns {{ match: Object|null, confidence: string }}
   */
  function exactMatch(value, options) {
    const target = value.toLowerCase().trim();

    for (const option of options) {
      if (option.text.toLowerCase().trim() === target) {
        return {
          match: option,
          confidence: 'exact',
          strategy: 'exact'
        };
      }
    }

    return { match: null, confidence: 'none', strategy: 'exact' };
  }

  /**
   * STRATEGY 2: Normalized match (remove articles, punctuation, etc.)
   *
   * @param {string} value
   * @param {Array<{text: string, index: number}>} options
   * @returns {{ match: Object|null, confidence: string }}
   */
  function normalizedMatch(value, options) {
    const target = normalize(value);
    if (!target) return { match: null, confidence: 'none', strategy: 'normalized' };

    for (const option of options) {
      const normalized = normalize(option.text);
      if (normalized === target) {
        return {
          match: option,
          confidence: 'high',
          strategy: 'normalized'
        };
      }
    }

    return { match: null, confidence: 'none', strategy: 'normalized' };
  }

  /**
   * STRATEGY 3: Fuzzy match via Levenshtein distance.
   * Accepts match if distance < threshold% of the longer string's length.
   *
   * @param {string} value
   * @param {Array<{text: string, index: number}>} options
   * @param {number} [threshold] - Max distance ratio (default: 0.30)
   * @returns {{ match: Object|null, confidence: string, distance: number }}
   */
  function fuzzyMatch(value, options, threshold) {
    const maxRatio = threshold || OriginFillFuzzyConfig.MAX_DISTANCE_RATIO;
    const target = normalize(value);
    if (!target) return { match: null, confidence: 'none', strategy: 'fuzzy', distance: Infinity };

    let bestMatch = null;
    let bestDistance = Infinity;

    for (const option of options) {
      const normalized = normalize(option.text);
      if (!normalized) continue;

      const distance = levenshteinDistance(target, normalized);
      const maxLen = Math.max(target.length, normalized.length);
      const ratio = distance / maxLen;

      if (ratio < maxRatio && distance < bestDistance) {
        bestDistance = distance;
        bestMatch = option;
      }
    }

    if (bestMatch) {
      return {
        match: bestMatch,
        confidence: bestDistance <= 2 ? 'high' : 'medium',
        strategy: 'fuzzy',
        distance: bestDistance
      };
    }

    return { match: null, confidence: 'none', strategy: 'fuzzy', distance: Infinity };
  }

  /**
   * STRATEGY 4: Keyword match.
   * Split value and options into keywords. Score by how much of the value an option covers,
   * penalising options with many extra words — so "United States" prefers
   * "United States of America" over "United States Minor Outlying Islands".
   *
   * @param {string} value
   * @param {Array<{text: string, index: number}>} options
   * @returns {{ match: Object|null, confidence: string, matchRatio: number }}
   */
  function keywordMatch(value, options) {
    const keywords = extractKeywords(value);
    if (keywords.length === 0) {
      return { match: null, confidence: 'none', strategy: 'keyword', matchRatio: 0 };
    }

    const minRatio = OriginFillFuzzyConfig.MIN_KEYWORD_MATCH_RATIO;
    const wordsMatch = (kw, word) => kw === word ||
      (kw.length >= 4 && word.startsWith(kw)) ||
      (word.length >= 4 && kw.startsWith(word));

    let bestMatch = null;
    let bestRatio = 0;
    let bestScore = 0;

    for (const option of options) {
      const optionWords = extractKeywords(option.text);
      if (optionWords.length === 0) continue;

      const matched = keywords.filter(kw => optionWords.some(word => wordsMatch(kw, word))).length;
      const ratio = matched / keywords.length;
      if (ratio < minRatio) continue;
      // "United States" must not match "United Arab Emirates" on one shared word
      if (keywords.length <= 2 && matched < keywords.length) continue;

      const precision = matched / optionWords.length;
      const score = ratio * 0.7 + precision * 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestRatio = ratio;
        bestMatch = option;
      }
    }

    if (bestMatch) {
      return {
        match: bestMatch,
        confidence: bestRatio >= 0.8 ? 'high' : 'medium',
        strategy: 'keyword',
        matchRatio: bestRatio
      };
    }

    return { match: null, confidence: 'none', strategy: 'keyword', matchRatio: 0 };
  }

  /**
   * STRATEGY 5: Fallback — look for "Other", "Not Listed", etc.
   *
   * @param {Array<{text: string, index: number}>} options
   * @returns {{ match: Object|null, confidence: string }}
   */
  function fallbackMatch(options) {
    const fallbackTerms = OriginFillFuzzyConfig.FALLBACK_OPTIONS;

    for (const term of fallbackTerms) {
      for (const option of options) {
        if (option.text.toLowerCase().trim() === term) {
          return {
            match: option,
            confidence: 'low',
            strategy: 'fallback',
            fallbackTerm: term
          };
        }
      }
    }

    // Partial match on fallback terms
    for (const term of fallbackTerms) {
      for (const option of options) {
        if (option.text.toLowerCase().includes(term)) {
          return {
            match: option,
            confidence: 'low',
            strategy: 'fallback',
            fallbackTerm: term
          };
        }
      }
    }

    return { match: null, confidence: 'none', strategy: 'fallback' };
  }

  // ─── Master Match Function ─────────────────────────────────────

  /**
   * Find the best match for a value among a list of options.
   * Tries all strategies in priority order.
   *
   * @param {string} value - The target value to match
   * @param {string[]|Array<{text: string}>} rawOptions - Available options (strings or objects with .text)
   * @param {Object} [config] - Override configuration
   * @param {number} [config.threshold] - Fuzzy match threshold
   * @param {boolean} [config.skipFallback] - Don't use fallback strategy
   * @returns {{
   *   matched: boolean,
   *   option: Object|null,
   *   confidence: string,
   *   strategy: string,
   *   details: Object
   * }}
   */
  function bestMatch(value, rawOptions, config = {}) {
    if (!value || !rawOptions || rawOptions.length === 0) {
      return {
        matched: false,
        option: null,
        confidence: 'none',
        strategy: 'none',
        details: { reason: !value ? 'empty value' : 'no options' }
      };
    }

    // Normalize options to { text, index, originalValue } format
    const options = rawOptions.map((opt, i) => {
      if (typeof opt === 'string') {
        return { text: opt, index: i, originalValue: opt };
      }
      return { text: opt.text || opt.textContent || opt.label || String(opt), index: i, originalValue: opt };
    });

    // Strategy 1: Exact match
    const exact = exactMatch(value, options);
    if (exact.match) {
      return {
        matched: true,
        option: exact.match,
        confidence: 'exact',
        strategy: 'exact',
        details: exact
      };
    }

    // Strategy 2: Normalized match
    const normalized = normalizedMatch(value, options);
    if (normalized.match) {
      return {
        matched: true,
        option: normalized.match,
        confidence: 'high',
        strategy: 'normalized',
        details: normalized
      };
    }

    // Strategy 3: Fuzzy match
    const fuzzy = fuzzyMatch(value, options, config.threshold);
    if (fuzzy.match) {
      return {
        matched: true,
        option: fuzzy.match,
        confidence: fuzzy.confidence,
        strategy: 'fuzzy',
        details: fuzzy
      };
    }

    // Strategy 4: Keyword match
    const keyword = keywordMatch(value, options);
    if (keyword.match) {
      return {
        matched: true,
        option: keyword.match,
        confidence: keyword.confidence,
        strategy: 'keyword',
        details: keyword
      };
    }

    // Strategy 5: Fallback
    if (!config.skipFallback) {
      const fallback = fallbackMatch(options);
      if (fallback.match) {
        return {
          matched: true,
          option: fallback.match,
          confidence: 'low',
          strategy: 'fallback',
          details: { ...fallback, originalValue: value }
        };
      }
    }

    // No match found
    return {
      matched: false,
      option: null,
      confidence: 'none',
      strategy: 'none',
      details: { value, optionCount: options.length, reason: 'no match found' }
    };
  }

  // ─── Convenience: Match Options from <select> Element ──────────

  /**
   * Match a value against options in a <select> element.
   *
   * @param {string} value - Value to match
   * @param {HTMLSelectElement} selectElement - The select element
   * @param {Object} [config] - Override configuration
   * @returns {Object} Match result from bestMatch()
   */
  function matchSelectOptions(value, selectElement, config = {}) {
    const options = Array.from(selectElement.options)
      .filter(opt => opt.value !== '' && !opt.disabled) // Skip placeholder options
      .map((opt, i) => ({
        text: opt.textContent.trim(),
        index: opt.index,
        value: opt.value,
        originalValue: opt
      }));

    return bestMatch(value, options, config);
  }

  // ─── Convenience: Pick a Dropdown Option ───────────────────────

  /**
   * Whether two labels say the same thing (case, punctuation and articles ignored).
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  function isSameText(a, b) {
    if (!a || !b) return false;
    return a.trim().toLowerCase() === b.trim().toLowerCase() || normalize(a) === normalize(b);
  }

  /**
   * Pick the option that best matches any of the candidate values.
   * Candidates are tried in priority order (the profile value first, then aliases), and exact
   * matches on any candidate win over fuzzy matches. Never falls back to "Other"-style options.
   *
   * @param {Array<{ el: any, text: string }>} options
   * @param {string[]} candidates
   * @returns {{ el: any, text: string, confidence: string }|null}
   */
  function pickOption(options, candidates) {
    const usable = options.filter(o => o.text && o.text.trim());
    const values = candidates.filter(c => c !== undefined && c !== null && String(c).trim()).map(String);
    if (usable.length === 0 || values.length === 0) return null;

    for (const value of values) {
      const exact = usable.find(o => isSameText(o.text, value));
      if (exact) return { ...exact, confidence: 'exact' };
    }

    // "4" years against "0-2 years", "3-5 years", "5+ years" — word matching would just see "years"
    if (NUMERIC_ANSWER.test(values[0].trim())) {
      const inRange = pickRange(usable, values[0]);
      return inRange ? { ...inRange, confidence: 'exact' } : null;
    }

    for (const value of values) {
      const result = bestMatch(value, usable.map(o => o.text), { skipFallback: true });
      if (result.matched && result.confidence !== 'low') {
        return { ...usable[result.option.index], confidence: result.confidence };
      }
    }

    return null;
  }

  /** A plain number of years: "4", "4.5", "4 years", "10+" */
  const NUMERIC_ANSWER = /^\d+(\.\d+)?\s*(\+|years?|yrs?)?$/i;

  /**
   * The option whose numeric range contains a number: "3-5 years", "5+", "More than 10",
   * "Less than 1 year", "Up to 2".
   * @param {Array<{ text: string }>} options
   * @param {string} value - A plain number, optionally followed by "years"
   * @returns {Object|null}
   */
  function pickRange(options, value) {
    const str = String(value).trim();
    if (!NUMERIC_ANSWER.test(str)) return null;
    const n = parseFloat(str);
    const num = '(\\d+(?:\\.\\d+)?)';

    for (const option of options) {
      const text = option.text.toLowerCase();
      let m = text.match(new RegExp(`${num}\\s*(?:-|–|—|to)\\s*${num}`));
      if (m) {
        if (n >= +m[1] && n <= +m[2]) return option;
        continue;
      }
      m = text.match(new RegExp(`${num}\\s*\\+|(?:more|greater)\\s+than\\s+${num}|\\bover\\s+${num}|${num}\\s+(?:years?\\s+)?(?:or|and)\\s+(?:more|above|over)`));
      if (m) {
        const inclusive = m[1] !== undefined || m[4] !== undefined;
        const min = +(m[1] ?? m[2] ?? m[3] ?? m[4]);
        if (inclusive ? n >= min : n > min) return option;
        continue;
      }
      m = text.match(new RegExp(`(?:less|fewer)\\s+than\\s+${num}|\\bunder\\s+${num}|\\bbelow\\s+${num}|\\bup\\s+to\\s+${num}`));
      if (m) {
        const inclusive = m[4] !== undefined;
        const max = +(m[1] ?? m[2] ?? m[3] ?? m[4]);
        if (inclusive ? n <= max : n < max) return option;
        continue;
      }
      m = text.match(new RegExp(`^${num}\\s*(?:years?|yrs?)?$`));
      if (m && n === +m[1]) return option;
    }
    return null;
  }

  // ─── Public API ─────────────────────────────────────────────────
  /**
   * How strongly an option reads as "my answer isn't listed": "Other" / "Others (please
   * specify)" and "Not listed" / "Not found" score highest, "Other University" next,
   * "None of the above" last. 0 for anything else ("None" and "N/A" mean something different).
   * @param {string} text
   * @returns {number}
   */
  function otherOptionScore(text) {
    const t = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!t) return 0;
    if (/^others?( please specify| specify)?$/.test(t)) return 4;
    if (/\b(not listed|unlisted|not found|not in (the )?list|not available in (the )?list|can t find|cannot find|could not find|couldn t find)\b/.test(t)) return 3;
    if (/^others?\b/.test(t) && t.split(' ').length <= 6) return 2;
    if (/\bnone of (the )?above\b/.test(t)) return 1;
    return 0;
  }

  /**
   * The "Other" / "Not listed" choice in a list, for when the real answer (a college or
   * course the form doesn't know) is missing. Only used when a caller asks for it: pickOption
   * itself never falls back to "Other".
   * @param {Array<{el: any, text: string}>} options
   * @returns {{el: any, text: string, confidence: 'other'}|null}
   */
  function pickOtherOption(options) {
    let best = null;
    let bestScore = 0;
    for (const option of options || []) {
      const score = otherOptionScore(option.text);
      if (score > bestScore) {
        best = option;
        bestScore = score;
      }
    }
    return best ? { ...best, confidence: 'other' } : null;
  }

  return Object.freeze({
    bestMatch,
    matchSelectOptions,
    pickOption,
    pickOtherOption,
    otherOptionScore,
    isSameText,
    levenshteinDistance,
    normalize,
    extractKeywords,

    // Individual strategies (for direct use)
    exactMatch,
    normalizedMatch,
    fuzzyMatch,
    keywordMatch,
    fallbackMatch
  });
})();
