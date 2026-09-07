use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::solana_program::program_error::ProgramError;

use crate::ErrorCode;

use super::HashSource;

#[account]
pub struct HashAccount {
    pub hash: [u8; 32],
    pub source: HashSource,
    pub voters: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl HashAccount {
    pub fn canonical_id(&self) -> [u8; 32] {
        Self::derive_id(&self.source, &self.hash)
    }

    pub fn derive_id(source: &HashSource, hash: &[u8; 32]) -> [u8; 32] {
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

    /// Enforces the liveness invariant shared by every instruction that reads a hash.
    pub fn validate_initialized(&self) -> Result<()> {
        require!(
            self.created_at != 0 && self.voters > 0,
            ErrorCode::HashNotFound
        );
        Ok(())
    }

    /// Adds one active witness without exposing counter arithmetic to use cases.
    pub fn add_voter(&mut self) -> Result<()> {
        self.voters = self
            .voters
            .checked_add(1)
            .ok_or(ProgramError::InvalidInstructionData)?;
        Ok(())
    }

    /// Removes one active witness and reports whether it was the final witness.
    pub fn remove_voter(&mut self) -> Result<bool> {
        let was_last = self.voters == 1;
        self.voters = self
            .voters
            .checked_sub(1)
            .ok_or(ProgramError::InvalidInstructionData)?;
        Ok(was_last)
    }

    /// Allocated size of this account, including its discriminator and padding.
    pub fn space(&self) -> usize {
        self.source.space()
    }
}
