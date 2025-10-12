use anchor_lang::prelude::*;

use crate::logic::seeds::SeedBundle;
use crate::state::{HashAccount, HashSource};

#[derive(Clone, Debug)]
pub struct DerivedHash {
    canonical_id: [u8; 32],
    pub key: Pubkey,
    pub bump: u8,
}

impl DerivedHash {
    pub fn canonical_id(&self) -> &[u8; 32] {
        &self.canonical_id
    }

    pub fn seeds(&self) -> SeedBundle {
        HashAccount::seed_bundle_from(&self.canonical_id, self.bump)
    }
}

pub fn derive_hash(program_id: &Pubkey, source: &HashSource, hash: &[u8; 32]) -> DerivedHash {
    let canonical_id = HashAccount::derive_id(source, hash);
    let (pda, bump) = HashAccount::derive_pda(program_id, &canonical_id);
    DerivedHash {
        canonical_id,
        key: pda,
        bump,
    }
}

pub fn new_state(source: HashSource, hash: [u8; 32], bump: u8) -> Result<HashAccount> {
    let created_at = Clock::get()?.unix_timestamp;
    Ok(HashAccount {
        hash,
        source,
        voters: 1,
        created_at,
        bump,
    })
}
