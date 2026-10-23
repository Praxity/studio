---
name: insecure-defaults
description: "Detects insecure default configurations including hardcoded credentials, fallback secrets, weak authentication defaults, and dangerous values in production. Source: Trail of Bits (https://github.com/trailofbits/skills)"
disable-model-invocation: true
---

# Insecure Defaults Detection

Identify fail-open vulnerabilities where applications operate insecurely due to missing configuration. The key distinction: **fail-open is critical, fail-secure is safe.**

## Core Distinction

**Fail-open (Critical):** App runs with weak secrets when env vars are absent.
```python
SECRET = os.environ.get('KEY', 'default')  # Runs with known secret
```

**Fail-secure (Safe):** App crashes if required config is missing.
```python
SECRET = os.environ['KEY']  # KeyError if missing — safe
```

## When to Use

- Security auditing production applications or services
- Configuration review of deployment manifests (Docker, Kubernetes, IaC)
- Pre-production checks before deploying new services
- Code review of authentication, authorization, or cryptographic code
- Environment variable handling analysis for secrets management
- API security review checking CORS, rate limiting, authentication

## Out of Scope

- Test-specific code in designated test directories
- Example and template files
- Development-only configurations
- Documentation examples
- Build-time configurations replaced during deployment
- Fail-secure patterns requiring proper configuration

## Quick Verification Checklist

### Fallback Secrets
- [ ] No `os.environ.get('SECRET', 'default-value')` patterns
- [ ] No `process.env.SECRET || 'fallback'` patterns
- [ ] No `ENV.fetch('SECRET', 'fallback')` patterns
- [ ] JWT/session/API secrets crash if missing

### Default Credentials
- [ ] No hardcoded admin accounts created on bootstrap
- [ ] No API keys with fallback values in code
- [ ] No database connection strings with embedded passwords

### Fail-Open Security
- [ ] Authentication required by default (not opt-in)
- [ ] CORS does not default to `*`
- [ ] Debug mode defaults to off
- [ ] Rate limiting enabled by default

### Weak Crypto
- [ ] No MD5/SHA1 for password hashing
- [ ] No DES/ECB for encryption
- [ ] Modern algorithms used (AES-256-GCM, Argon2, bcrypt)

### Permissive Access
- [ ] File permissions not world-writable (no 0o666)
- [ ] Storage buckets not public by default
- [ ] CORS with credentials does not allow all origins

### Debug Features
- [ ] No stack traces in API responses
- [ ] GraphQL introspection disabled in production
- [ ] Verbose error messages only in logs, not responses

## Analysis Workflow

**Phase 1 - Discovery:** Identify language, framework, and relevant patterns in configuration files, authentication modules, and database connections.

**Phase 2 - Verification:** Trace code execution paths to determine runtime behavior when configuration variables are absent.

**Phase 3 - Impact Assessment:** Confirm whether production environments supply required variables or depend on insecure defaults.

**Phase 4 - Documentation:** Report findings with specific file locations and exploitation scenarios.

## Examples

### Vulnerable: Environment variable with fallback
```python
# src/auth/jwt.py
SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-123')
def create_token(user_id):
    return jwt.encode({'user_id': user_id}, SECRET_KEY, algorithm='HS256')
```
App runs with known secret if `SECRET_KEY` is missing. Attacker can forge tokens.

### Vulnerable: Authentication disabled by default
```python
REQUIRE_AUTH = os.getenv('REQUIRE_AUTH', 'false').lower() == 'true'
@app.before_request
def check_auth():
    if not REQUIRE_AUTH:
        return  # Skip auth check
```
Default is no authentication. App runs insecurely if env var missing.

### Vulnerable: CORS allows all origins
```javascript
const allowedOrigins = process.env.ALLOWED_ORIGINS || '*';
app.use(cors({ origin: allowedOrigins }));
```
Default allows requests from any origin.

### Secure: Crashes without config
```python
SECRET_KEY = os.environ['SECRET_KEY']  # Raises KeyError if missing
```

### Secure: Auth required by default
```python
REQUIRE_AUTH = os.getenv('REQUIRE_AUTH', 'true').lower() == 'true'
```

### Secure: CORS requires explicit config
```javascript
if (!process.env.ALLOWED_ORIGINS) {
  throw new Error('ALLOWED_ORIGINS must be configured');
}
```
