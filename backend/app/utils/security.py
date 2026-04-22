from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt

from app.config import settings


# bcrypt has a 72-byte input limit; truncate transparently as passlib did.
# Using bcrypt directly avoids the passlib dependency (unmaintained since 2020
# and incompatible with bcrypt>=5 which removed passlib's __about__ probe).
_BCRYPT_ROUNDS = 12


def _truncate(password: str) -> bytes:
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_truncate(password), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_truncate(plain), hashed.encode("utf-8"))
    except ValueError:
        # Malformed hash — treat as verification failure rather than raising.
        return False


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRE_HOURS)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
