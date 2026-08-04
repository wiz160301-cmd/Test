from app.core.billing import session_is_paid
from app.core.config import settings
from app.models.payment import Payment, PaymentStatus
from app.models.remote_session import RemoteSession


def test_unpaid_session_is_not_paid(db_session):
    session = RemoteSession()
    db_session.add(session)
    db_session.commit()

    assert session_is_paid(db_session, session.id) is False


def test_session_with_paid_payment_is_paid(db_session):
    session = RemoteSession()
    db_session.add(session)
    db_session.commit()

    payment = Payment(session_id=session.id, amount_cents=4900, status=PaymentStatus.PAID)
    db_session.add(payment)
    db_session.commit()

    assert session_is_paid(db_session, session.id) is True


def test_pending_payment_does_not_count_as_paid(db_session):
    session = RemoteSession()
    db_session.add(session)
    db_session.commit()

    payment = Payment(session_id=session.id, amount_cents=4900, status=PaymentStatus.PENDING)
    db_session.add(payment)
    db_session.commit()

    assert session_is_paid(db_session, session.id) is False


def test_freemium_disabled_bypasses_payment_check(db_session, monkeypatch):
    monkeypatch.setattr(settings, "freemium_enabled", False)
    session = RemoteSession()
    db_session.add(session)
    db_session.commit()

    assert session_is_paid(db_session, session.id) is True
