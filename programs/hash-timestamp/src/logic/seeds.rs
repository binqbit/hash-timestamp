use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;

use crate::state::{HashAccount, VoteInfo};

#[derive(Clone, Debug)]
pub struct SeedBundle {
    parts: Vec<Vec<u8>>,
}

impl SeedBundle {
    pub fn new(parts: Vec<Vec<u8>>) -> Self {
        Self { parts }
    }

    pub fn with_signer<F>(&self, f: F) -> Result<()>
    where
        F: FnOnce(&[&[&[u8]]]) -> std::result::Result<(), ProgramError>,
    {
        let seed_refs: Vec<&[u8]> = self.parts.iter().map(|p| p.as_slice()).collect();
        let signer = [seed_refs.as_slice()];
        f(&signer).map_err(Into::into)
    }

    pub fn parts(&self) -> &[Vec<u8>] {
        &self.parts
    }
}

impl HashAccount {
    pub fn seed_bundle_from(canonical_id: &[u8; 32], bump: u8) -> SeedBundle {
        SeedBundle::new(vec![b"hash".to_vec(), canonical_id.to_vec(), vec![bump]])
    }

    pub fn seed_bundle(&self) -> SeedBundle {
        Self::seed_bundle_from(&self.canonical_id(), self.bump)
    }
}

impl VoteInfo {
    pub fn seed_bundle_from(voter: &Pubkey, hash_id: &[u8; 32], bump: u8) -> SeedBundle {
        SeedBundle::new(vec![
            b"vote".to_vec(),
            voter.to_bytes().to_vec(),
            hash_id.to_vec(),
            vec![bump],
        ])
    }

    pub fn seed_bundle(&self) -> SeedBundle {
        Self::seed_bundle_from(&self.voter, &self.hash_id, self.bump)
    }
}
