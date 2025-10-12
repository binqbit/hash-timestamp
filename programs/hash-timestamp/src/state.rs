use anchor_lang::prelude::*;

mod hash_account;
mod hash_source;

pub const HASH_ACCOUNT_BASE_SIZE: usize = 8 /*disc*/
    + 32 /*hash*/
    + 8  /*voters*/
    + 8  /*created_at*/
    + 1; /*bump*/

pub const VOTE_INFO_SPACE: usize = 8 /*disc*/
    + 32 /*voter*/
    + 32 /*hash_id*/
    + 8  /*amount*/
    + 1  /*bump*/
    + 7; /*padding*/

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum HashSource {
    Hash,
    Account {
        account: Pubkey,
    },
    Branch {
        previous_hash_id: [u8; 32],
        payload: [u8; 32],
        generation: u64,
    },
    Batch {
        members: Vec<[u8; 32]>,
    },
    Pack,
}

impl Default for HashSource {
    fn default() -> Self {
        HashSource::Hash
    }
}

#[account]
pub struct HashAccount {
    pub hash: [u8; 32],
    pub source: HashSource,
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
