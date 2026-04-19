/**
 * Lades-Pro Dayanıklılık (Resilience) Modülü
 * 
 * Bu modül sistemin %99.9 uptime hedefine ulaşması için gereken 
 * Hata Yönetimi, Retry ve Circuit Breaker desenlerini içerir.
 */

// ─── ÖZEL HATA SINIFLARI (CUSTOM EXCEPTION CLASSES) ──────────────────────────

class LadesError extends Error {
  constructor(message, code = "INTERNAL_ERROR", details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
    Error.captureStackTrace(this, this.constructor);
  }
}

class DatabaseError extends LadesError {
  constructor(message, details) {
    super(message, "DATABASE_ERROR", details);
  }
}

class ExternalServiceError extends LadesError {
  constructor(message, details) {
    super(message, "EXTERNAL_SERVICE_ERROR", details);
  }
}

class CircuitBreakerError extends LadesError {
  constructor(message) {
    super(message, "CIRCUIT_OPEN_ERROR");
  }
}

// ─── RETRY MEKANİZMASI (EXPONENTIAL BACKOFF) ────────────────────────────────

/**
 * Bir işlemi belirli bir sayıda ve artan bekleme süresiyle tekrar dener.
 * @param {Function} operation - Denenecek asenkron fonksiyon
 * @param {Object} options - Retry ayarları
 */
async function withRetry(operation, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    onRetry = null,
    shouldRetry = () => true
  } = options;

  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (!shouldRetry(error) || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 200 - 100;
      const waitTime = Math.max(0, delay + jitter);

      if (onRetry) onRetry(error, attempt + 1, waitTime);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError;
}

// ─── CIRCUIT BREAKER (DEVRE KESİCİ) ─────────────────────────────────────────

class CircuitBreaker {
  /**
   * @param {Function} action - Korunacak asenkron fonksiyon
   * @param {Object} options - CB ayarları
   */
  constructor(action, options = {}) {
    this.action = action;
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.openTimeout = options.openTimeout || 30000; // 30 sn
    
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = Date.now();
  }

  async fire(...args) {
    if (this.state === "OPEN") {
      if (this.nextAttempt <= Date.now()) {
        this.state = "HALF_OPEN";
      } else {
        throw new CircuitBreakerError(`Servis geçici olarak devre dışı (Circuit OPEN). Kalan: ${Math.round((this.nextAttempt - Date.now())/1000)}sn`);
      }
    }

    try {
      const result = await this.action(...args);
      return this.onSuccess(result);
    } catch (error) {
      return this.onFailure(error);
    }
  }

  onSuccess(result) {
    this.failures = 0;
    if (this.state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.state = "CLOSED";
        this.successes = 0;
      }
    }
    return result;
  }

  onFailure(error) {
    this.failures++;
    if (this.failures >= this.failureThreshold || this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.nextAttempt = Date.now() + this.openTimeout;
    }
    throw error;
  }
}

module.exports = {
  LadesError,
  DatabaseError,
  ExternalServiceError,
  CircuitBreakerError,
  withRetry,
  CircuitBreaker,
};
