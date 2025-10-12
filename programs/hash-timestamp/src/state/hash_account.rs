use anchor_lang::prelude::*;

use crate::ErrorCode;

use super::{HashAccount, HashSource, VoteInfo};

impl HashAccount {
    pub fn canonical_id(&self) -> [u8; 32] {
        Self::derive_id(&self.source, &self.hash)
    }

    pub fn derive_id(source: &HashSource, hash: &[u8; 32]) -> [u8; 32] {
        use anchor_lang::solana_program::hash::hashv;
        hashv(&[hash.as_ref(), &[source.discriminator()]]).to_bytes()
    }

    pub fn derive_pda(program_id: &Pubkey, hash_id: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"hash", hash_id.as_ref()], program_id)
    }

    pub fn verify_account(&self, program_id: &Pubkey, account: &AccountInfo) -> Result<()> {
        let (expected, bump) = Self::derive_pda(program_id, &self.canonical_id());
        require_keys_eq!(account.key(), expected, ErrorCode::InvalidHashSeeds);
        require_eq!(self.bump, bump, ErrorCode::InvalidHashSeeds);
        Ok(())
    }

    pub fn current_generation(&self) -> u64 {
        self.source.generation()
    }

    pub fn space(&self) -> usize {
        self.source.space()
    }
}

impl VoteInfo {
    pub fn derive_pda(program_id: &Pubkey, hash_id: &[u8; 32], voter: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"vote", voter.as_ref(), hash_id.as_ref()], program_id)
    }
}
