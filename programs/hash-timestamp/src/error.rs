use anchor_lang::prelude::*;

/// Stable protocol errors.
///
/// Variant order is part of the public ABI: Anchor assigns codes starting at
/// 6000. Never reorder or remove a variant in a compatible release.
#[error_code]
pub enum ErrorCode {
    #[msg("Hash not found")]
    HashNotFound,
    #[msg("Invalid hash PDA seeds")]
    InvalidHashSeeds,
    #[msg("Already voted for this hash")]
    AlreadyVoted,
    #[msg("Caller is not the voter")]
    NotVoter,
    #[msg("Votes are not zero")]
    VotesNotZero,
    #[msg("Derived hash mismatch")]
    DerivedHashMismatch,
    #[msg("Expected vote account for migration")]
    VoteAccountMissing,
    #[msg("Vote migration requested but no vote exists")]
    NoVoteToMigrate,
    #[msg("Hash generation overflowed")]
    GenerationOverflow,
    #[msg("Hash already exists")]
    HashAlreadyExists,
    #[msg("Batch requires at least one member")]
    BatchMembersEmpty,
    #[msg("Batch member account not owned by the program")]
    BatchMemberWrongProgram,
    #[msg("Pack requires at least one member")]
    PackMembersEmpty,
    #[msg("Pack member account not owned by the program")]
    PackMemberWrongProgram,
    #[msg("Restore proof cannot be empty")]
    RestoreChainTooShort,
    #[msg("Restore proof contains duplicate canonical IDs")]
    RestoreProofDuplicate,
    #[msg("Restore proof references a missing dependency")]
    RestoreDependencyMissing,
    #[msg("Restore pack proof missing member list")]
    RestorePackMembersMissing,
    #[msg("Restore hash proof missing original payload")]
    RestoreHashPayloadMissing,
    #[msg("Restore account snapshot required to recreate account hash")]
    RestoreAccountSnapshotMissing,
    #[msg("Restore tip proof does not match the current hash account")]
    RestoreTipMismatch,
    #[msg("Restore proof data is inconsistent")]
    RestoreProofMismatch,
    #[msg("Restore proof timestamp mismatch")]
    RestoreTimestampMismatch,
    #[msg("Restore proof generation mismatch")]
    RestoreGenerationMismatch,
    #[msg("Restore remaining accounts must be hash/vote pairs")]
    RestoreAccountsMisaligned,
    #[msg("PDA placeholder must be an empty, non-executable system account")]
    InvalidPdaPlaceholder,
    #[msg("Batch contains a duplicate member")]
    BatchMemberDuplicate,
    #[msg("Pack contains a duplicate member")]
    PackMemberDuplicate,
}
