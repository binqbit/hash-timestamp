use anchor_lang::prelude::*;

use super::HASH_ACCOUNT_BASE_SIZE;

const FIXED_SOURCE_PADDING: usize = 6;
const BATCH_SOURCE_PADDING: usize = 2;

/// Describes how a hash record entered the history graph.
///
/// Variant order is both Borsh ABI and part of the canonical hash identity.
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
        Self::Hash
    }
}

impl HashSource {
    pub fn register() -> Self {
        HashSource::Hash
    }

    pub fn account(account: Pubkey) -> Self {
        HashSource::Account { account }
    }

    pub fn branch(previous_hash_id: [u8; 32], payload: [u8; 32], generation: u64) -> Self {
        HashSource::Branch {
            previous_hash_id,
            payload,
            generation,
        }
    }

    pub fn batch(members: Vec<[u8; 32]>) -> Self {
        HashSource::Batch { members }
    }

    pub fn pack() -> Self {
        HashSource::Pack
    }

    pub fn discriminator(&self) -> u8 {
        match self {
            HashSource::Hash => 0,
            HashSource::Account { .. } => 1,
            HashSource::Branch { .. } => 2,
            HashSource::Batch { .. } => 3,
            HashSource::Pack => 4,
        }
    }

    /// Space reserved for the encoded source plus compatibility padding.
    ///
    /// Padding values are part of the deployed account-size contract even though
    /// Borsh itself does not serialize those bytes.
    pub fn allocated_source_space(&self) -> usize {
        match self {
            HashSource::Hash => 1 + FIXED_SOURCE_PADDING,
            HashSource::Account { .. } => 1 + 32 + FIXED_SOURCE_PADDING,
            HashSource::Branch { .. } => 1 + 32 + 32 + 8 + FIXED_SOURCE_PADDING,
            HashSource::Batch { members } => 1 + 4 + (members.len() * 32) + BATCH_SOURCE_PADDING,
            HashSource::Pack => 1 + FIXED_SOURCE_PADDING,
        }
    }

    pub fn generation(&self) -> u64 {
        match self {
            HashSource::Branch { generation, .. } => *generation,
            _ => 0,
        }
    }

    /// Total allocated `HashAccount` size for this source variant.
    pub fn space(&self) -> usize {
        HASH_ACCOUNT_BASE_SIZE + self.allocated_source_space()
    }
}
