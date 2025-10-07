use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

use crate::ErrorCode;

// Space helpers
pub const PREVIOUS_BLOCK_SIZE: usize = 32 /*hash_id*/
    + 8  /*created_at*/
    + 8; /*generation*/

pub const HASH_ACCOUNT_SPACE: usize = 8 /*disc*/
    + PREVIOUS_BLOCK_SIZE
    + 32 /*hash*/
    + 1  /*hash_type*/
    + 8  /*voters*/
    + 8  /*created_at*/
    + 1  /*bump*/
    + 6; /*padding*/

pub const VOTE_INFO_SPACE: usize = 8 /*disc*/
    + 32 /*voter*/
    + 32 /*hash_id*/
    + 8  /*amount*/
    + 1  /*bump*/
    + 7; /*padding*/

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum HashType {
    Hash = 0,
    Account = 1,
    Branch = 2,
    Batch = 3,
}

impl Default for HashType {
    fn default() -> Self {
        HashType::Hash
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug)]
pub struct PreviousBlock {
    pub hash_id: [u8; 32],
    pub created_at: i64,
    pub generation: u64,
}

#[account]
pub struct HashAccount {
    pub previous: PreviousBlock,
    pub hash: [u8; 32],
    pub hash_type: HashType,
    pub voters: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct VoteInfo {
    pub voter: Pubkey,
    pub hash_id: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}

impl HashAccount {
    pub fn canonical_id(&self) -> [u8; 32] {
        Self::derive_id(
            &self.previous.hash_id,
            self.previous.created_at,
            &self.hash,
            self.hash_type,
        )
    }

    pub fn derive_id(
        previous_hash_id: &[u8; 32],
        previous_created_at: i64,
        hash: &[u8; 32],
        hash_type: HashType,
    ) -> [u8; 32] {
        hashv(&[
            previous_hash_id.as_ref(),
            &previous_created_at.to_le_bytes(),
            hash.as_ref(),
            &[hash_type as u8],
        ])
        .to_bytes()
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
        if matches!(
            self.hash_type,
            HashType::Hash | HashType::Account | HashType::Batch
        ) {
            0
        } else {
            self.previous.generation.saturating_add(1)
        }
    }
}

impl VoteInfo {
    pub fn derive_pda(program_id: &Pubkey, hash_account: &Pubkey, voter: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"vote", hash_account.as_ref(), voter.as_ref()],
            program_id,
        )
    }
}
