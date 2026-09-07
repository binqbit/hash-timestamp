//! Pure, deterministic hash protocol.
//!
//! Every byte order and discriminator used here is part of the public protocol.
//! This module must not read sysvars, perform CPI, or mutate accounts.

pub(crate) mod branch;
pub(crate) mod compose;
pub(crate) mod metadata;
pub(crate) mod snapshot;

pub(crate) use compose::AccountFingerprint;
pub(crate) use snapshot::HashSnapshot;
