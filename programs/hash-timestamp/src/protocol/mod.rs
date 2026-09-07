//! Deterministic protocol rules.
//!
//! Code in this layer may derive hashes and addresses, but never performs CPI
//! or mutates an on-chain account.

pub(crate) mod address;
pub(crate) mod hash;
pub(crate) mod restore;
