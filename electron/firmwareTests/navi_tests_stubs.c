// NAVI firmware tests: what own code may call that the test build leaves out (split, see transactions.h). Weak, so
// own code that defines one itself keeps its own.
#include <string.h>

#include "transactions.h"

__attribute__((weak)) void transaction_register_rpc(int8_t transaction_id, slave_callback_t callback) {}

// No other half: the call counts as sent and anything it asks back reads as zeros.
__attribute__((weak)) bool transaction_rpc_exec(int8_t transaction_id, uint8_t initiator2target_buffer_size, const void *initiator2target_buffer, uint8_t target2initiator_buffer_size, void *target2initiator_buffer) {
    if (target2initiator_buffer && target2initiator_buffer_size) memset(target2initiator_buffer, 0, target2initiator_buffer_size);
    return true;
}
