use anchor_lang::prelude::*;

use super::{HashSource, HASH_ACCOUNT_BASE_SIZE};

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

    pub fn serialized_size(&self) -> usize {
        match self {
            HashSource::Hash => 1 + 6,
            HashSource::Account { .. } => 1 + 32 + 6,
            HashSource::Branch { .. } => 1 + 32 + 32 + 8 + 6,
            HashSource::Batch { members } => 1 + 4 + (members.len() * 32) + 2,
            HashSource::Pack => 1 + 6,
        }
    }

    pub fn generation(&self) -> u64 {
        match self {
            HashSource::Branch { generation, .. } => *generation,
            _ => 0,
        }
    }

    pub fn space(&self) -> usize {
        HASH_ACCOUNT_BASE_SIZE + self.serialized_size()
    }
}
