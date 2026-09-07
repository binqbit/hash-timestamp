use crate::state::{HashAccount, HashSource};

/// Immutable protocol input captured from an already validated hash account.
#[derive(Clone, Debug)]
pub(crate) struct HashSnapshot {
    canonical_id: [u8; 32],
    hash: [u8; 32],
    source: HashSource,
    created_at: i64,
    voters: u64,
}

impl HashSnapshot {
    /// Copies protocol fields only; ownership, liveness and PDA checks belong to runtime.
    pub(crate) fn from_account(account: &HashAccount) -> Self {
        Self {
            canonical_id: account.canonical_id(),
            hash: account.hash,
            source: account.source.clone(),
            created_at: account.created_at,
            voters: account.voters,
        }
    }

    pub(crate) fn canonical_id(&self) -> &[u8; 32] {
        &self.canonical_id
    }

    pub(crate) fn hash(&self) -> &[u8; 32] {
        &self.hash
    }

    pub(crate) fn source(&self) -> &HashSource {
        &self.source
    }

    pub(crate) fn created_at(&self) -> i64 {
        self.created_at
    }

    pub(crate) fn generation(&self) -> u64 {
        self.source.generation()
    }

    pub(crate) fn voters(&self) -> u64 {
        self.voters
    }
}
