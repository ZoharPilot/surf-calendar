// Surf Quality Scoring System
// מערכת ניקוד מתקדמת לאיכות תנאי גלישה

/**
 * חישוב ציון איכות לשעה נתונה
 * מחזיר אובייקט עם ציון כולל (0-100) ופירוט
 */
function calculateSurfQuality(conditions, config) {
  const { waveHeight, wavePeriod, windSpeed, windDirection } = conditions;

  // בדיקת דרישות מינימום קשיחות (Hard Requirements)
  if (!meetsHardRequirements(conditions, config)) {
    return {
      score: 0,
      valid: false,
      reason: 'Does not meet minimum requirements'
    };
  }

  // חישוב ציונים לכל פרמטר
  const waveScore = scoreWaveHeight(waveHeight, config);
  const periodScore = scoreWavePeriod(wavePeriod, waveHeight, config);
  const windSpeedScore = scoreWindSpeed(windSpeed, config);
  const windDirScore = scoreWindDirection(windDirection, config);

  // חישוב ציון כולל משוקלל
  const totalScore =
    (waveScore.score * config.qualityWeights.waveHeight) +
    (periodScore.score * config.qualityWeights.wavePeriod) +
    (windSpeedScore.score * config.qualityWeights.windSpeed) +
    (windDirScore.score * config.qualityWeights.windDirection);

  return {
    score: Math.round(totalScore),
    valid: true,
    breakdown: {
      waveHeight: waveScore,
      wavePeriod: periodScore,
      windSpeed: windSpeedScore,
      windDirection: windDirScore
    }
  };
}

/**
 * בדיקת דרישות מינימום קשיחות
 * אלו תנאים שחייבים להתקיים - אחרת השעה נפסלת לחלוטין
 */
function meetsHardRequirements(conditions, config) {
  const { waveHeight, wavePeriod, windSpeed } = conditions;
  const thresholds = config.hardRequirements;

  // בדיקות בסיסיות
  if (waveHeight < thresholds.minWaveHeight) return false;
  if (waveHeight > thresholds.maxWaveHeight) return false;
  if (windSpeed > thresholds.maxWindSpeed) return false;

  // תקופה מינימלית - יותר גמיש
  // אם התקופה קצרה אבל הגל גבוה, עדיין עשוי להיות בסדר
  const minPeriodRequired = calculateMinPeriodForHeight(waveHeight, thresholds);
  if (wavePeriod < minPeriodRequired) return false;

  return true;
}

/**
 * חישוב תקופת גל מינימלית נדרשת בהתאם לגובה הגל
 *
 * עקרון חשוב: swellHeight הוא נתון offshore, לא surf height!
 * תקופה קצרה (<7s) = wind chop, לא swell איכותי לגלישה
 * גל גבוה עם תקופה קצרה = תנאים גרועים (choppy)
 */
function calculateMinPeriodForHeight(waveHeight, thresholds) {
  const basePeriod = thresholds.minWavePeriod; // Default: 6s (but should be 7s)

  // גלים קטנים (עד 0.8m / 2.6ft) - סף מינימלי 6s
  if (waveHeight < 0.8) {
    return Math.max(basePeriod, 6);
  }

  // גלים בינוניים (0.8-1.5m / 2.6-5ft) - נדרשת תקופה של לפחות 7s
  if (waveHeight < 1.5) {
    return Math.max(basePeriod, 7);
  }

  // גלים גבוהים (1.5-2.5m / 5-8ft) - נדרשת תקופה של לפחות 8s
  // Use fixed 8s threshold, not basePeriod+2 which could be 9s
  if (waveHeight < 2.5) {
    return 8;
  }

  // גלים גבוהים מאוד (2.5m+ / 8ft+) - נדרשת תקופה ארוכה (10s+)
  // אחרת זה סתם wind chop מסוכן
  return Math.max(basePeriod + 4, 10);
}

/**
 * ניקוד גובה גל (0-100)
 */
function scoreWaveHeight(height, config) {
  const optimal = config.optimalRanges.waveHeight;

  // טווח אופטימלי (0.8-1.5 מטר) = 100 נקודות
  if (height >= optimal.min && height <= optimal.max) {
    return {
      score: 100,
      category: 'optimal',
      description: `גובה אידיאלי: ${height.toFixed(1)}m`
    };
  }

  // מעל האופטימום אבל עדיין טוב (1.5-2.0)
  if (height > optimal.max && height <= 2.0) {
    const score = 100 - ((height - optimal.max) / (2.0 - optimal.max)) * 20;
    return {
      score: Math.max(score, 80),
      category: 'good',
      description: `גובה טוב: ${height.toFixed(1)}m`
    };
  }

  // מתחת לאופטימום אבל עדיין סביר (0.4-0.8)
  if (height < optimal.min && height >= 0.4) {
    const score = 100 - ((optimal.min - height) / (optimal.min - 0.4)) * 30;
    return {
      score: Math.max(score, 70),
      category: 'acceptable',
      description: `גובה סביר: ${height.toFixed(1)}m`
    };
  }

  // קצוות - מינימלי
  return {
    score: 60,
    category: 'minimal',
    description: `גובה מינימלי: ${height.toFixed(1)}m`
  };
}

/**
 * ניקוד תקופת גל (0-100)
 * תקופה ארוכה = גלים חזקים ונקיים יותר
 * אבל גם תקופה קצרה יכולה להיות טובה אם הגל גבוה מספיק
 */
function scoreWavePeriod(period, waveHeight, config) {
  const optimal = config.optimalRanges.wavePeriod;

  // תקופה אופטימלית (8-12 שניות) = 100 נקודות
  if (period >= optimal.min && period <= optimal.max) {
    return {
      score: 100,
      category: 'optimal',
      description: `תקופה מצוינת: ${Math.round(period)}s`
    };
  }

  // תקופה ארוכה מדי (>12) - עדיין טוב אבל פחות
  if (period > optimal.max) {
    const score = 100 - ((period - optimal.max) / 5) * 10;
    return {
      score: Math.max(score, 85),
      category: 'long',
      description: `תקופה ארוכה: ${Math.round(period)}s`
    };
  }

  // תקופה קצרה (6-8) - תלוי בגובה הגל
  if (period >= 6 && period < optimal.min) {
    // אם הגל גבוה (>1m), תקופה קצרה עדיין יכולה להיות טובה
    if (waveHeight > 1.0) {
      const heightBonus = Math.min((waveHeight - 1.0) * 20, 15);
      const baseScore = 70 + ((period - 6) / (optimal.min - 6)) * 15;
      return {
        score: Math.min(baseScore + heightBonus, 95),
        category: 'short-but-decent',
        description: `תקופה קצרה אבל גל גבוה: ${Math.round(period)}s`
      };
    }

    // גל נמוך + תקופה קצרה = פחות טוב
    const score = 60 + ((period - 6) / (optimal.min - 6)) * 20;
    return {
      score: Math.max(score, 60),
      category: 'short',
      description: `תקופה קצרה: ${Math.round(period)}s`
    };
  }

  // תקופה קצרה מדי (<6) - מינימלי
  if (period >= 4) {
    // אם הגל ממש גבוה (>1.5m), עדיין יכול להיות בסדר
    if (waveHeight > 1.5) {
      return {
        score: 65,
        category: 'very-short-but-high',
        description: `תקופה קצרה מאוד אבל גל גבוה: ${Math.round(period)}s`
      };
    }

    return {
      score: 50,
      category: 'minimal',
      description: `תקופה קצרה מאוד: ${Math.round(period)}s`
    };
  }

  return {
    score: 30,
    category: 'poor',
    description: `תקופה גרועה: ${Math.round(period)}s`
  };
}

/**
 * ניקוד מהירות רוח (0-100)
 * רוח חלשה = טוב יותר
 */
function scoreWindSpeed(speed, config) {
  const optimal = config.optimalRanges.windSpeed;

  // רוח חלשה מאוד (0-3 קשר) = מושלם
  if (speed <= optimal.perfect) {
    return {
      score: 100,
      category: 'perfect',
      description: `רוח חלשה מאוד: ${Math.round(speed)} קשר`
    };
  }

  // רוח חלשה (3-5) = מצוין
  if (speed <= optimal.excellent) {
    const score = 100 - ((speed - optimal.perfect) / (optimal.excellent - optimal.perfect)) * 10;
    return {
      score: Math.max(score, 90),
      category: 'excellent',
      description: `רוח חלשה: ${Math.round(speed)} קשר`
    };
  }

  // רוח בינונית (5-8) = סביר
  if (speed <= optimal.acceptable) {
    const score = 90 - ((speed - optimal.excellent) / (optimal.acceptable - optimal.excellent)) * 30;
    return {
      score: Math.max(score, 60),
      category: 'acceptable',
      description: `רוח בינונית: ${Math.round(speed)} קשר`
    };
  }

  // רוח חזקה (>8) = לא טוב
  return {
    score: 40,
    category: 'poor',
    description: `רוח חזקה: ${Math.round(speed)} קשר`
  };
}

/**
 * ניקוד כיוון רוח (0-100)
 * offshore = הכי טוב, onshore = פחות טוב
 */
function scoreWindDirection(direction, config) {
  // הרצליה: 270-360 (מערב-צפון) = offshore
  const isOffshore = direction >= 270 || direction <= 90;
  const isOnshore = direction > 90 && direction < 270;

  if (isOffshore) {
    // Offshore = מושלם (90-100 נקודות)
    // צפון-מערב (315) הוא הכי טוב
    const distanceFrom315 = Math.abs(direction - 315);
    const score = 100 - (distanceFrom315 / 180) * 10;
    return {
      score: Math.max(score, 90),
      category: 'offshore',
      description: 'רוח offshore (מצוין)'
    };
  }

  if (isOnshore) {
    // Onshore = פחות טוב (50-70 נקודות)
    return {
      score: 60,
      category: 'onshore',
      description: 'רוח onshore (פחות אידיאלי)'
    };
  }

  // Cross-shore
  return {
    score: 75,
    category: 'cross',
    description: 'רוח צידית'
  };
}

/**
 * בדיקה אם ציון עובר את הסף המינימלי
 */
function isQualityScoreAcceptable(qualityResult, minScore = 65) {
  return qualityResult.valid && qualityResult.score >= minScore;
}

/**
 * קביעת רמת קושי והמלצות לפי תנאי הגלישה
 * @param {number} waveHeightMeters - גובה גל במטרים
 * @param {number} windSpeed - מהירות רוח בקשר
 * @param {number} windDirection - כיוון רוח במעלות
 * @returns {Object} אובייקט עם רמת קושי והמלצות
 */
function getSurfingRecommendations(waveHeightMeters, windSpeed, windDirection) {
  const waveHeightFeet = waveHeightMeters * 3.28;

  // בדיקה אם רוח דרומית/דרום-מערבית (135-225 מעלות)
  const isSouthWind = windDirection >= 135 && windDirection <= 225;

  // תנאים קיצוניים - גלים גבוהים מאוד + רוח חזקה
  if (waveHeightFeet > 8 && windSpeed > 15) {
    if (isSouthWind) {
      return {
        level: 'extreme-marina',
        levelHebrew: 'קיצוני - מתאים למרינה',
        emoji: '🌊⚠️',
        recommendation: 'תנאים קיצוניים! מומלץ לגלוש במרינה הרצליה (מוגן יותר עם רוח דרומית)',
        audienceHebrew: 'גולשים מנוסים בלבד - מרינה'
      };
    } else {
      return {
        level: 'extreme',
        levelHebrew: 'קיצוני',
        emoji: '⚠️',
        recommendation: 'תנאים קיצוניים! לא מומלץ לגלישה',
        audienceHebrew: 'מסוכן - לא מומלץ'
      };
    }
  }

  // גלים גבוהים - למתקדמים
  if (waveHeightFeet > 5) {
    return {
      level: 'advanced',
      levelHebrew: 'מתקדמים',
      emoji: '🏄‍♂️',
      recommendation: 'גלים גבוהים - מתאים לגולשים מתקדמים',
      audienceHebrew: 'גולשים מתקדמים'
    };
  }

  // תנאים אידיאליים - 3-5 פיט
  if (waveHeightFeet >= 3 && waveHeightFeet <= 5) {
    return {
      level: 'optimal',
      levelHebrew: 'אידיאלי',
      emoji: '✨',
      recommendation: 'תנאים מצוינים! גובה גל אידיאלי לרוב הגולשים',
      audienceHebrew: 'כל הרמות'
    };
  }

  // גלים קטנים - טוב למתחילים/בינוניים
  if (waveHeightFeet < 3) {
    return {
      level: 'beginner-friendly',
      levelHebrew: 'מתאים למתחילים',
      emoji: '🌊',
      recommendation: 'גלים קטנים - מומלץ לגולשים עם נפח (longboard/funboard)',
      audienceHebrew: 'מתחילים ובינוניים - מומלץ עם נפח'
    };
  }

  // ברירת מחדל
  return {
    level: 'moderate',
    levelHebrew: 'בינוני',
    emoji: '🏄',
    recommendation: 'תנאי גלישה סבירים',
    audienceHebrew: 'רוב הגולשים'
  };
}

module.exports = {
  calculateSurfQuality,
  meetsHardRequirements,
  isQualityScoreAcceptable,
  getSurfingRecommendations,
  scoreWaveHeight,
  scoreWavePeriod,
  scoreWindSpeed,
  scoreWindDirection
};
