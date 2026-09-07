//! Solana account runtime boundary.
//!
//! This layer owns serialization, System Program CPI, PDA allocation and
//! lamport/account lifecycle mechanics, plus validated account adapters for
//! aggregate, vote migration and restore. It never owns an instruction scenario.

// Record adapters and lifecycle operations.
pub(crate) mod aggregate;
pub(crate) mod hash_record;
pub(crate) mod metadata;
pub(crate) mod record_lifecycle;
pub(crate) mod restore;
pub(crate) mod vote_migration;
pub(crate) mod vote_record;

// Low-level Solana account mechanics.
pub(crate) mod account_io;
pub(crate) mod lamports;
pub(crate) mod pda_account;

#[cfg(test)]
mod tests;
