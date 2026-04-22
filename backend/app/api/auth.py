import logging
import uuid
from collections import defaultdict
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.database import get_db
from app.api.docs import build_error_responses
from app.middleware.rate_limit import limiter
from app.models.user import User
from app.schemas.user import RegisterResponse, Token, UserCreate, UserLogin, UserResponse
from app.utils.security import create_access_token, decode_access_token, hash_password, verify_password


_auth_logger = logging.getLogger("app.auth")

_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 900  # 15 minutes

_login_attempts: defaultdict[str, list[float]] = defaultdict(list)


router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _check_login_rate_limit(email: str) -> None:
    now = monotonic()
    window_start = now - _LOGIN_WINDOW_SECONDS
    attempts = _login_attempts[email]
    _login_attempts[email] = [attempt for attempt in attempts if attempt > window_start]
    if len(_login_attempts[email]) >= _LOGIN_MAX_ATTEMPTS:
        _auth_logger.warning("login blocked for email=%s (too many attempts)", email)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
        )


def _record_failed_login(email: str) -> None:
    _login_attempts[email].append(monotonic())
    _auth_logger.warning("failed login attempt for email=%s", email)


def _clear_login_attempts(email: str) -> None:
    _login_attempts.pop(email, None)


def _create_user_access_token(user: User) -> str:
    return create_access_token({"sub": str(user.id), "email": user.email})


async def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        subject = payload.get("sub")
        if not subject:
            raise credentials_error
        user_id = uuid.UUID(subject)
    except (JWTError, ValueError) as exc:
        raise credentials_error from exc

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_error
    request.state.user = user
    return user


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a user",
    description="Create a new user account with an email address and password.",
    response_description="The newly created user account and bearer access token.",
    responses=build_error_responses(
        extra={409: "A user with the same email address is already registered."},
    ),
)
@limiter.limit("3/minute")
async def register_user(
    request: Request,
    response: Response,
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
) -> RegisterResponse:
    existing_user = await db.execute(select(User).where(User.email == payload.email))
    if existing_user.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered.")

    user = User(email=payload.email, hashed_password=hash_password(payload.password))
    db.add(user)
    try:
        await db.commit()
        await db.refresh(user)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered") from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        _auth_logger.exception("register: db error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account creation failed. Try again.",
        ) from exc
    access_token = _create_user_access_token(user)
    _auth_logger.info("new user registered email=%s user_id=%s", user.email, user.id)
    user_payload = UserResponse.model_validate(user)
    return RegisterResponse(
        id=user_payload.id,
        email=user_payload.email,
        created_at=user_payload.created_at,
        access_token=access_token,
        user=user_payload,
    )


@router.post(
    "/login",
    response_model=Token,
    status_code=status.HTTP_200_OK,
    summary="Authenticate a user",
    description="Validate the provided credentials and return a bearer access token.",
    response_description="An access token for authenticated API requests.",
    responses=build_error_responses(
        unauthorized="The provided email or password is invalid.",
    ),
)
@limiter.limit("5/minute")
async def login_user(
    request: Request,
    response: Response,
    payload: UserLogin,
    db: AsyncSession = Depends(get_db),
) -> Token:
    _check_login_rate_limit(payload.email)

    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.hashed_password):
        _record_failed_login(payload.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    access_token = _create_user_access_token(user)
    _clear_login_attempts(payload.email)
    _auth_logger.info("successful login for email=%s user_id=%s", payload.email, user.id)
    return Token(access_token=access_token)


@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get the current user",
    description="Return the profile for the currently authenticated user.",
    response_description="The authenticated user's profile.",
    responses=build_error_responses(
        unauthorized="Authentication is required to access the current user profile.",
    ),
)
async def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user
