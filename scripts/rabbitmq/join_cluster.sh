#!/bin/bash
# RabbitMQ cluster join script

set -e

echo "Waiting for RabbitMQ to start..."
sleep 10

echo "Stopping RabbitMQ app..."
rabbitmqctl stop_app

echo "Joining cluster..."
rabbitmqctl join_cluster rabbit@rabbitmq_1

echo "Starting RabbitMQ app..."
rabbitmqctl start_app

echo "Setting HA policy for all queues..."
rabbitmqctl set_policy ha-all ".*" '{"ha-mode":"all","ha-sync-mode":"automatic"}'

echo "RabbitMQ cluster join completed"
