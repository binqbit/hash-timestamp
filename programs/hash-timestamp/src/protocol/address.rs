use anchor_lang::prelude::*;

use crate::state::{HashAccount, HashSource, VoteInfo};

const HASH_SEED: &[u8] = b"hash";
const VOTE_SEED: &[u8] = b"vote";

/// Owned seed bytes whose borrowed representation is valid for one signed CPI.
#[derive(Clone, Debug)]
pub(crate) struct PdaSignerSeeds {
    parts: Vec<Vec<u8>>,
}

impl PdaSignerSeeds {
    fn new(parts: Vec<Vec<u8>>) -> Self {
        Self { parts }
    }

    pub(crate) fn with_signer<T>(
        &self,
        invoke: impl FnOnce(&[&[&[u8]]]) -> Result<T>,
    ) -> Result<T> {
        let seed_parts: Vec<&[u8]> = self.parts.iter().map(Vec::as_slice).collect();
        let signer = [seed_parts.as_slice()];
        invoke(&signer)
    }
}

/// Canonical identity, PDA and bump of a hash record.
#[derive(Clone, Debug)]
pub(crate) struct HashAddress {
    canonical_id: [u8; 32],
    pub(crate) key: Pubkey,
    pub(crate) bump: u8,
}

impl HashAddress {
    pub(crate) fn derive(program_id: &Pubkey, source: &HashSource, hash: &[u8; 32]) -> Self {
        let canonical_id = HashAccount::derive_id(source, hash);
        let (key, bump) = HashAccount::derive_pda(program_id, &canonical_id);
        Self {
            canonical_id,
            key,
            bump,
        }
    }

    pub(crate) fn canonical_id(&self) -> &[u8; 32] {
        &self.canonical_id
    }

    pub(crate) fn signer_seeds(&self) -> PdaSignerSeeds {
        PdaSignerSeeds::new(vec![
            HASH_SEED.to_vec(),
            self.canonical_id.to_vec(),
            vec![self.bump],
        ])
    }
}

/// Canonical PDA and state identity of a voter's witness record.
#[derive(Clone, Debug)]
pub(crate) struct VoteAddress {
    pub(crate) key: Pubkey,
    pub(crate) bump: u8,
    hash_id: [u8; 32],
    voter: Pubkey,
}

impl VoteAddress {
    pub(crate) fn derive(program_id: &Pubkey, hash_id: &[u8; 32], voter: &Pubkey) -> Self {
        let (key, bump) = VoteInfo::derive_pda(program_id, hash_id, voter);
        Self {
            key,
            bump,
            hash_id: *hash_id,
            voter: *voter,
        }
    }

    pub(crate) fn hash_id(&self) -> &[u8; 32] {
        &self.hash_id
    }

    pub(crate) fn voter(&self) -> &Pubkey {
        &self.voter
    }

    pub(crate) fn signer_seeds(&self) -> PdaSignerSeeds {
        PdaSignerSeeds::new(vec![
            VOTE_SEED.to_vec(),
            self.voter.to_bytes().to_vec(),
            self.hash_id.to_vec(),
            vec![self.bump],
        ])
    }
}
